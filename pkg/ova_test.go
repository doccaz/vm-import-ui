// pkg/ova_test.go
package main

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"regexp"
	"strings"
	"testing"
)

// memFile builds an OvaFile backed by an in-memory buffer.
func memFile(name string, data []byte) OvaFile {
	return OvaFile{
		Name: name,
		Size: int64(len(data)),
		OpenAt: func(offset int64) (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data[offset:])), nil
		},
	}
}

// zeroFile builds an OvaFile of the given size without allocating it, so the
// multi-gigabyte cases stay cheap. Assertions are on headers, not content.
func zeroFile(name string, size int64) OvaFile {
	return OvaFile{
		Name: name,
		Size: size,
		OpenAt: func(offset int64) (io.ReadCloser, error) {
			return io.NopCloser(zeroReader{}), nil
		},
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

func buildOVA(t *testing.T, base string, descriptor []byte, files []OvaFile, chunkSize int64) []byte {
	t.Helper()
	chunks, _, err := PlanChunks(files, chunkSize)
	if err != nil {
		t.Fatalf("PlanChunks: %v", err)
	}
	chunks, err = HashChunks(chunks)
	if err != nil {
		t.Fatalf("HashChunks: %v", err)
	}
	var buf bytes.Buffer
	if err := WriteOVA(&buf, base, descriptor, chunks); err != nil {
		t.Fatalf("WriteOVA: %v", err)
	}
	return buf.Bytes()
}

type member struct {
	name string
	size int64
	fmtv tar.Format
	data []byte
}

func readMembers(t *testing.T, ova []byte, keepData bool) []member {
	t.Helper()
	tr := tar.NewReader(bytes.NewReader(ova))
	var out []member
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("reading tar: %v", err)
		}
		m := member{name: hdr.Name, size: hdr.Size, fmtv: hdr.Format}
		if keepData {
			b, err := io.ReadAll(tr)
			if err != nil {
				t.Fatalf("reading member %s: %v", hdr.Name, err)
			}
			m.data = b
		}
		out = append(out, m)
	}
	return out
}

// DSP0243 clause 469-474: descriptor first, then the manifest, then the
// referenced files in References order.
func TestWriteOVA_MemberOrder(t *testing.T) {
	desc := []byte("<Envelope/>")
	files := []OvaFile{
		memFile("disk-0.vmdk", []byte("aaaa")),
		memFile("disk-1.vmdk", []byte("bbbb")),
	}
	members := readMembers(t, buildOVA(t, "vm", desc, files, defaultChunkSize), false)

	want := []string{"vm.ovf", "vm.mf", "disk-0.vmdk", "disk-1.vmdk"}
	if len(members) != len(want) {
		t.Fatalf("got %d members, want %d: %+v", len(members), len(want), members)
	}
	for i, w := range want {
		if members[i].name != w {
			t.Errorf("member %d is %q, want %q", i, members[i].name, w)
		}
	}
}

// Clause 485-486 requires strict USTAR.
func TestWriteOVA_UstarFormatAndMagic(t *testing.T) {
	ova := buildOVA(t, "vm", []byte("<Envelope/>"), []OvaFile{memFile("disk-0.vmdk", []byte("data"))}, defaultChunkSize)

	for _, m := range readMembers(t, ova, false) {
		if m.fmtv != tar.FormatUSTAR {
			t.Errorf("member %s has format %v, want USTAR", m.name, m.fmtv)
		}
	}

	// Check the raw header bytes too: the USTAR magic lives at offset 257 of
	// each 512-byte header block, and must be "ustar\x0000".
	const magic = "ustar\x0000"
	if got := string(ova[257 : 257+len(magic)]); got != magic {
		t.Errorf("header magic = %q, want %q", got, magic)
	}
}

// The tar itself must not be compressed: a .ova is a plain tar, and gzip would
// make the descriptor unreadable without unpacking the whole archive.
func TestWriteOVA_NotCompressed(t *testing.T) {
	ova := buildOVA(t, "vm", []byte("<Envelope/>"), []OvaFile{memFile("d.vmdk", []byte("x"))}, defaultChunkSize)
	if len(ova) >= 2 && ova[0] == 0x1f && ova[1] == 0x8b {
		t.Fatal("output starts with the gzip magic; the OVA tar must not be compressed")
	}
	if !bytes.Contains(ova[:512], []byte("vm.ovf")) {
		t.Error("the descriptor name should be readable in the first header block")
	}
}

// Clause 415-421 fixes the manifest grammar exactly. Assert the bytes.
func TestBuildManifest_ExactGrammar(t *testing.T) {
	desc := []byte("<Envelope/>")
	files := []OvaFile{memFile("disk-0.vmdk", []byte("payload"))}
	members := readMembers(t, buildOVA(t, "vm", desc, files, defaultChunkSize), true)

	var mf []byte
	for _, m := range members {
		if m.name == "vm.mf" {
			mf = m.data
		}
	}
	if mf == nil {
		t.Fatal("no manifest member")
	}

	descSum := fmt.Sprintf("%x", sha256.Sum256(desc))
	diskSum := fmt.Sprintf("%x", sha256.Sum256([]byte("payload")))
	want := "SHA256(vm.ovf)= " + descSum + "\nSHA256(disk-0.vmdk)= " + diskSum + "\n"
	if string(mf) != want {
		t.Errorf("manifest bytes mismatch\n got: %q\nwant: %q", string(mf), want)
	}

	// No space before "(", exactly one after "=", lowercase hex, LF endings.
	line := regexp.MustCompile(`^SHA256\([^ ()]+\)= [0-9a-f]{64}$`)
	for _, l := range strings.Split(strings.TrimSuffix(string(mf), "\n"), "\n") {
		if !line.MatchString(l) {
			t.Errorf("manifest line does not match the DSP0243 grammar: %q", l)
		}
	}
	if bytes.Contains(mf, []byte("\r")) {
		t.Error("manifest must use LF line endings only")
	}
	// The manifest itself must never be listed.
	if bytes.Contains(mf, []byte("vm.mf")) {
		t.Error("the manifest must not contain an entry for itself")
	}
}

// A file at or below the chunk size keeps its plain name and declares no
// ovf:chunkSize. Emitting a suffix here would send consumers looking for a
// member that does not exist.
func TestPlanChunks_NoChunkingAtOrBelowThreshold(t *testing.T) {
	for _, size := range []int64{1, defaultChunkSize - 1, defaultChunkSize} {
		chunks, sizes, err := PlanChunks([]OvaFile{zeroFile("disk-0.vmdk", size)}, defaultChunkSize)
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		if len(chunks) != 1 {
			t.Errorf("size %d: got %d chunks, want 1", size, len(chunks))
		}
		if chunks[0].Name != "disk-0.vmdk" {
			t.Errorf("size %d: name %q, want the unsuffixed href", size, chunks[0].Name)
		}
		if len(sizes) != 0 {
			t.Errorf("size %d: ovf:chunkSize must not be declared for an unsplit file", size)
		}
	}
}

// Clause 542-556 and Annex D.4: chunk-number is exactly 9 decimal digits, 0-based.
func TestPlanChunks_SuffixesAndSizes(t *testing.T) {
	const chunkSize = int64(1024)
	chunks, sizes, err := PlanChunks([]OvaFile{zeroFile("disk-0.vmdk", 2500)}, chunkSize)
	if err != nil {
		t.Fatalf("PlanChunks: %v", err)
	}

	wantNames := []string{"disk-0.vmdk.000000000", "disk-0.vmdk.000000001", "disk-0.vmdk.000000002"}
	wantSizes := []int64{1024, 1024, 452}
	if len(chunks) != 3 {
		t.Fatalf("got %d chunks, want 3", len(chunks))
	}
	for i := range chunks {
		if chunks[i].Name != wantNames[i] {
			t.Errorf("chunk %d name %q, want %q", i, chunks[i].Name, wantNames[i])
		}
		if chunks[i].Size != wantSizes[i] {
			t.Errorf("chunk %d size %d, want %d", i, chunks[i].Size, wantSizes[i])
		}
		if chunks[i].Offset != int64(i)*chunkSize {
			t.Errorf("chunk %d offset %d, want %d", i, chunks[i].Offset, int64(i)*chunkSize)
		}
	}
	if sizes["disk-0.vmdk"] != chunkSize {
		t.Errorf("ovf:chunkSize = %d, want %d", sizes["disk-0.vmdk"], chunkSize)
	}
}

// Chunk content must reassemble to the original file, in order.
func TestWriteOVA_ChunksReassemble(t *testing.T) {
	payload := bytes.Repeat([]byte("0123456789"), 250) // 2500 bytes
	ova := buildOVA(t, "vm", []byte("<Envelope/>"), []OvaFile{memFile("disk-0.vmdk", payload)}, 1024)

	var got []byte
	for _, m := range readMembers(t, ova, true) {
		if strings.HasPrefix(m.name, "disk-0.vmdk") {
			got = append(got, m.data...)
		}
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("reassembled %d bytes, want %d, content mismatch", len(got), len(payload))
	}
}

// The whole point of chunking: a disk larger than the USTAR member limit must
// still produce a strict-USTAR archive.
func TestWriteOVA_OverEightGiBStaysUstar(t *testing.T) {
	if testing.Short() {
		t.Skip("writes >8 GiB through the tar writer")
	}
	const size = ustarMaxMemberSize + 1
	chunks, sizes, err := PlanChunks([]OvaFile{zeroFile("big.vmdk", size)}, defaultChunkSize)
	if err != nil {
		t.Fatalf("PlanChunks: %v", err)
	}
	if sizes["big.vmdk"] != defaultChunkSize {
		t.Fatalf("expected the file to be chunked")
	}
	for _, c := range chunks {
		if c.Size > ustarMaxMemberSize {
			t.Fatalf("chunk %s is %d bytes, still over the USTAR limit", c.Name, c.Size)
		}
	}

	// Stream through a counting writer rather than io.Discard, so the test
	// proves the bytes really were written instead of silently short-circuiting.
	for i := range chunks {
		chunks[i].SHA256 = strings.Repeat("0", 64)
	}
	cw := &countingWriter{}
	if err := WriteOVA(cw, "vm", []byte("<Envelope/>"), chunks); err != nil {
		t.Fatalf("WriteOVA with chunked >8GiB disk: %v", err)
	}
	if cw.n < size {
		t.Fatalf("wrote only %d bytes, expected at least the %d bytes of disk payload", cw.n, size)
	}
	for _, m := range readMembersStreaming(t, chunks) {
		if m.fmtv != tar.FormatUSTAR {
			t.Errorf("chunk %s has format %v, want USTAR", m.name, m.fmtv)
		}
	}
}

type countingWriter struct{ n int64 }

func (w *countingWriter) Write(p []byte) (int, error) {
	w.n += int64(len(p))
	return len(p), nil
}

// readMembersStreaming re-emits just the headers for the given chunks (with zero
// sizes) so their tar.Format can be asserted without moving the payload twice.
func readMembersStreaming(t *testing.T, chunks []Chunk) []member {
	t.Helper()
	small := make([]Chunk, len(chunks))
	for i, c := range chunks {
		small[i] = Chunk{
			Name: c.Name, Base: c.Base, Size: 0, SHA256: c.SHA256,
			openAt: func(int64) (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(nil)), nil },
		}
	}
	var buf bytes.Buffer
	if err := WriteOVA(&buf, "vm", []byte("<Envelope/>"), small); err != nil {
		t.Fatalf("WriteOVA(headers): %v", err)
	}
	return readMembers(t, buf.Bytes(), false)
}

// Guard the constraint itself: an unchunked oversized member must be rejected,
// not silently promoted to PAX.
func TestWriteOVA_RejectsOversizedMember(t *testing.T) {
	chunks := []Chunk{{
		Name:   "big.vmdk",
		Base:   "big.vmdk",
		Size:   ustarMaxMemberSize + 1,
		SHA256: strings.Repeat("0", 64),
		openAt: func(int64) (io.ReadCloser, error) { return io.NopCloser(zeroReader{}), nil },
	}}
	err := WriteOVA(io.Discard, "vm", []byte("<Envelope/>"), chunks)
	if err == nil {
		t.Fatal("expected an error for a member over the USTAR limit")
	}
	if !strings.Contains(err.Error(), "USTAR") {
		t.Errorf("error should explain the USTAR limit, got: %v", err)
	}
}

// Clause 462: entries shall exist only once.
func TestPlanChunks_RejectsDuplicates(t *testing.T) {
	_, _, err := PlanChunks([]OvaFile{memFile("d.vmdk", []byte("a")), memFile("d.vmdk", []byte("b"))}, defaultChunkSize)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Errorf("expected a duplicate-entry error, got %v", err)
	}
}

func TestValidateMemberName(t *testing.T) {
	cases := []struct {
		name string
		ok   bool
	}{
		{"disk-0.vmdk", true},
		{"disk-0.vmdk.000000000", true},
		{"", false},
		{"dir/disk.vmdk", false},
		{"./disk.vmdk", false},
		{strings.Repeat("a", 101), false},
		{"discö.vmdk", false},
	}
	for _, c := range cases {
		err := validateMemberName(c.name)
		if (err == nil) != c.ok {
			t.Errorf("validateMemberName(%q) error=%v, want ok=%v", c.name, err, c.ok)
		}
	}
}

// Assembling the same inputs twice must produce identical bytes, so golden
// fixtures are stable.
func TestWriteOVA_Deterministic(t *testing.T) {
	mk := func() []byte {
		return buildOVA(t, "vm", []byte("<Envelope/>"), []OvaFile{memFile("d.vmdk", []byte("payload"))}, defaultChunkSize)
	}
	if !bytes.Equal(mk(), mk()) {
		t.Error("WriteOVA is not deterministic")
	}
}
