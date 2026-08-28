// pkg/ova.go
//
// OVA package assembly: the tar container defined by DMTF DSP0243 v2.1.1.
//
// This file is deliberately pure — it takes bytes and readers, and knows nothing
// about Kubernetes, vCenter or HTTP. Everything here is driven by the spec:
//
//   - clause 485-486: "A compressed OVF package shall be created by using the TAR
//     format that complies with the USTAR (Uniform Standard Tape Archive) format
//     as defined by ISO/IEC/IEEE 9945:2009."
//   - clause 463-481: legal member orderings (we emit the descriptor, then the
//     manifest, then the referenced files in References order).
//   - clause 462: "Entries in a compressed OVF package shall exist only once."
//   - clause 542-556: chunking, via ovf:chunkSize and 9-digit chunk suffixes.
//   - clause 405-421: the manifest file grammar.
package main

import (
	"archive/tar"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const (
	// ustarMaxMemberSize is the largest member a strict USTAR header can encode.
	// The size field is 12 bytes of octal, i.e. 11 significant digits, so the
	// limit is 2^33-1. Go's archive/tar returns an error rather than silently
	// promoting to PAX when Header.Format is pinned to FormatUSTAR.
	ustarMaxMemberSize = int64(1)<<33 - 1

	// ustarMaxNameLen is the USTAR name field width. We never emit a prefix, so
	// every member name must fit here on its own.
	ustarMaxNameLen = 100

	// defaultChunkSize is the size at which referenced files are split. Chunking
	// exists solely to work around the USTAR 8 GiB-1 member cap (clause
	// 542-556), so this is pinned to that cap rather than to DSP0243 Annex
	// D.4's 2 GiB worked example: a smaller default chunks disks that would
	// otherwise fit in one member for no spec-mandated reason, and at least one
	// real consumer, virt-v2v's -i ova input (see
	// https://github.com/libguestfs/virt-v2v/issues/189), misreads multiple
	// chunk files as a VMware CBT snapshot chain and silently reads only the
	// last one — so a disk that never needed chunking should never get it.
	defaultChunkSize = ustarMaxMemberSize
)

// OvaFile is one file referenced from the OVF descriptor's <References> section,
// before any chunking is applied.
type OvaFile struct {
	// Name is the base href, e.g. "disk-0.vmdk". Chunk suffixes are added by
	// PlanChunks; never include one here.
	Name string
	Size int64
	// OpenAt returns a reader positioned at offset bytes from the start.
	OpenAt func(offset int64) (io.ReadCloser, error)
}

// Chunk is a single tar member. A file small enough to avoid chunking produces
// exactly one Chunk whose Name equals the file's Name, with no numeric suffix.
type Chunk struct {
	Name   string // "disk-0.vmdk" or "disk-0.vmdk.000000000"
	Base   string // the owning file's href, always without a suffix
	Size   int64
	Offset int64  // offset within the owning file
	SHA256 string // lowercase hex; filled in by HashChunks

	openAt func(offset int64) (io.ReadCloser, error)
}

// open returns a reader over exactly this chunk's bytes.
func (c Chunk) open() (io.ReadCloser, error) {
	rc, err := c.openAt(c.Offset)
	if err != nil {
		return nil, err
	}
	return readCloser{Reader: io.LimitReader(rc, c.Size), Closer: rc}, nil
}

type readCloser struct {
	io.Reader
	io.Closer
}

// LocalFile adapts a file on disk to OvaFile.OpenAt.
func LocalFile(path string) func(int64) (io.ReadCloser, error) {
	return func(offset int64) (io.ReadCloser, error) {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		if offset != 0 {
			if _, err := f.Seek(offset, io.SeekStart); err != nil {
				f.Close()
				return nil, err
			}
		}
		return f, nil
	}
}

// PlanChunks splits files that exceed chunkSize into spec-conformant chunks.
//
// It returns the ordered tar members and, for each file that was actually split,
// the ovf:chunkSize value the descriptor must declare. Files that fit in a single
// chunk are absent from that map and keep their plain name — emitting a
// chunkSize attribute for an unsplit file would make consumers look for
// "name.000000000", which does not exist.
func PlanChunks(files []OvaFile, chunkSize int64) ([]Chunk, map[string]int64, error) {
	if chunkSize <= 0 {
		chunkSize = defaultChunkSize
	}
	if chunkSize > ustarMaxMemberSize {
		return nil, nil, fmt.Errorf("chunk size %d exceeds the USTAR member limit %d", chunkSize, ustarMaxMemberSize)
	}

	var chunks []Chunk
	sizes := map[string]int64{}
	seen := map[string]bool{}

	for _, f := range files {
		if f.Name == "" {
			return nil, nil, fmt.Errorf("referenced file has no name")
		}
		if seen[f.Name] {
			// DSP0243 clause 462: entries shall exist only once.
			return nil, nil, fmt.Errorf("duplicate referenced file %q", f.Name)
		}
		seen[f.Name] = true
		if f.OpenAt == nil {
			return nil, nil, fmt.Errorf("referenced file %q has no OpenAt", f.Name)
		}

		if f.Size <= chunkSize {
			chunks = append(chunks, Chunk{Name: f.Name, Base: f.Name, Size: f.Size, openAt: f.OpenAt})
			continue
		}

		sizes[f.Name] = chunkSize
		for offset, n := int64(0), 0; offset < f.Size; offset, n = offset+chunkSize, n+1 {
			size := chunkSize
			if remaining := f.Size - offset; remaining < size {
				size = remaining
			}
			// clause 549-554: chunk-url = href-value "." chunk-number, where
			// chunk-number is exactly 9 decimal digits, 0-based.
			chunks = append(chunks, Chunk{
				Name:   fmt.Sprintf("%s.%09d", f.Name, n),
				Base:   f.Name,
				Size:   size,
				Offset: offset,
				openAt: f.OpenAt,
			})
		}
	}
	return chunks, sizes, nil
}

// HashChunks computes the SHA256 of every chunk, returning a copy of the slice
// with SHA256 populated. Callers that already know a chunk's digest (for example
// because it was computed while the file was being written) can skip this.
func HashChunks(chunks []Chunk) ([]Chunk, error) {
	out := make([]Chunk, len(chunks))
	copy(out, chunks)
	for i := range out {
		if out[i].SHA256 != "" {
			continue
		}
		sum, err := hashChunk(out[i])
		if err != nil {
			return nil, fmt.Errorf("hashing %s: %w", out[i].Name, err)
		}
		out[i].SHA256 = sum
	}
	return out, nil
}

func hashChunk(c Chunk) (string, error) {
	rc, err := c.open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	h := sha256.New()
	if _, err := io.Copy(h, rc); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// manifestEntry is one line of the .mf file.
type manifestEntry struct {
	name   string
	sha256 string
}

// BuildManifest renders the .mf file.
//
// DSP0243 clause 415-421 fixes the grammar exactly:
//
//	file_digest = algorithm "(" file_name ")" "=" sp digest nl
//	sp = %x20 ; nl = %x0A
//
// So: no space before the parenthesis, exactly one space after "=", lowercase
// hex, and LF line endings. A space before the parenthesis is a real-world cause
// of "the OVF package is invalid" rejections.
//
// Clause 406 requires SHA256 for packages authored to this version. Per Annex D.1
// Example 2 the descriptor itself is listed; the manifest and certificate are not
// (clause 443-446 keeps them out of References, and they are excluded here).
func BuildManifest(entries []manifestEntry) []byte {
	var b strings.Builder
	for _, e := range entries {
		fmt.Fprintf(&b, "SHA256(%s)= %s\n", e.name, e.sha256)
	}
	return []byte(b.String())
}

// WriteOVA assembles the .ova tar into w.
//
// Member order is DSP0243 clause 469-474: the OVF descriptor first, then the
// manifest, then the referenced files in the order they appear in <References>.
// (Clause 476-481 permits the manifest last instead, which would allow
// single-pass hashing; we use the conventional ordering because it is what
// consumers exercise most.)
//
// Every header is pinned to tar.FormatUSTAR. Any member at or above 8 GiB is a
// programming error at this point — PlanChunks exists to prevent it — and is
// reported rather than silently promoted to PAX.
func WriteOVA(w io.Writer, baseName string, descriptor []byte, chunks []Chunk) error {
	if baseName == "" {
		return fmt.Errorf("baseName is required")
	}
	ovfName := baseName + ".ovf"
	mfName := baseName + ".mf"

	// The manifest covers the descriptor and every chunk, in that order.
	entries := []manifestEntry{{name: ovfName, sha256: fmt.Sprintf("%x", sha256.Sum256(descriptor))}}
	for _, c := range chunks {
		if c.SHA256 == "" {
			return fmt.Errorf("chunk %s has no SHA256; call HashChunks first", c.Name)
		}
		entries = append(entries, manifestEntry{name: c.Name, sha256: c.SHA256})
	}
	manifest := BuildManifest(entries)

	tw := tar.NewWriter(w)

	if err := writeMember(tw, ovfName, int64(len(descriptor)), func() (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(string(descriptor))), nil
	}); err != nil {
		return err
	}
	if err := writeMember(tw, mfName, int64(len(manifest)), func() (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(string(manifest))), nil
	}); err != nil {
		return err
	}
	for _, c := range chunks {
		if err := writeMember(tw, c.Name, c.Size, c.open); err != nil {
			return err
		}
	}
	return tw.Close()
}

// ovaModTime is a fixed timestamp so that assembling the same inputs twice
// produces byte-identical archives. tar's USTAR mtime field is whole seconds;
// a non-zero nanosecond would make Go prefer PAX.
var ovaModTime = time.Unix(0, 0).UTC()

func writeMember(tw *tar.Writer, name string, size int64, open func() (io.ReadCloser, error)) error {
	if err := validateMemberName(name); err != nil {
		return err
	}
	if size > ustarMaxMemberSize {
		return fmt.Errorf("member %q is %d bytes, which exceeds the USTAR limit of %d; it must be chunked",
			name, size, ustarMaxMemberSize)
	}

	// Fields are pinned rather than inherited so the output is deterministic and
	// stays inside strict USTAR.
	hdr := &tar.Header{
		Name:     name,
		Mode:     0o644,
		Size:     size,
		ModTime:  ovaModTime,
		Typeflag: tar.TypeReg,
		Format:   tar.FormatUSTAR,
		Uid:      0,
		Gid:      0,
		Uname:    "",
		Gname:    "",
	}
	if err := tw.WriteHeader(hdr); err != nil {
		return fmt.Errorf("writing header for %s: %w", name, err)
	}

	rc, err := open()
	if err != nil {
		return fmt.Errorf("opening %s: %w", name, err)
	}
	defer rc.Close()

	n, err := io.Copy(tw, rc)
	if err != nil {
		return fmt.Errorf("writing %s: %w", name, err)
	}
	if n != size {
		// tar has already committed a header claiming `size`; a short read would
		// silently corrupt the archive, so fail loudly.
		return fmt.Errorf("member %s declared %d bytes but produced %d", name, size, n)
	}
	return nil
}

// validateMemberName enforces the USTAR name constraints. We never emit the
// prefix field, so the whole name must fit in 100 bytes, and OVA members are
// flat basenames — no directories, no "./" prefix.
func validateMemberName(name string) error {
	switch {
	case name == "":
		return fmt.Errorf("member name is empty")
	case len(name) > ustarMaxNameLen:
		return fmt.Errorf("member name %q is %d bytes, over the USTAR limit of %d", name, len(name), ustarMaxNameLen)
	case strings.ContainsAny(name, "/\\"):
		return fmt.Errorf("member name %q must be a flat basename", name)
	}
	for i := 0; i < len(name); i++ {
		if name[i] < 0x20 || name[i] > 0x7e {
			return fmt.Errorf("member name %q contains a non-ASCII byte", name)
		}
	}
	return nil
}
