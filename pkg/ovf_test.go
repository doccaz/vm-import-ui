// pkg/ovf_test.go
package main

import (
	"encoding/xml"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var updateGolden = flag.Bool("update", false, "rewrite the golden OVF descriptors")

// ovfTestInput mirrors a real Harvester VM (labs/windows-server-2022 shape):
// two disks, a NIC, an empty CD-ROM drive, BIOS firmware.
func ovfTestInput() OVFInput {
	return OVFInput{
		Name:         "sles15sp6",
		Namespace:    "labs",
		CPUs:         4,
		MemoryMB:     6144,
		Firmware:     "bios",
		MachineType:  "q35",
		Architecture: "amd64",
		FirmwareUUID: "f672972a-7aa6-4b67-a062-5ccb397a010d",
		Disks: []OVFDisk{
			{Href: "disk-0.vmdk", FileSize: 8123456789, CapacityBytes: 53687091200, BusType: "virtio", BootOrder: 1},
			{Href: "disk-1.vmdk", FileSize: 1048576, CapacityBytes: 1073741824, BusType: "scsi"},
		},
		Networks:     []OVFNetwork{{Name: "default", Model: "virtio", MAC: "82:c7:54:0f:c6:08"}},
		CDROMs:       1,
		PreserveMACs: true,
		Annotation:   "Exported from Harvester by vm-import-ui",
	}
}

func allProfiles() []Profile { return []Profile{ProfileVMware, ProfilePortable, ProfileFaithful} }

func TestBuildOVF_Golden(t *testing.T) {
	for _, p := range allProfiles() {
		t.Run(string(p), func(t *testing.T) {
			got, err := BuildOVF(ovfTestInput(), p)
			if err != nil {
				t.Fatalf("BuildOVF: %v", err)
			}
			path := filepath.Join("testdata", "ovf", string(p)+".ovf")
			if *updateGolden {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("reading golden file (run: go test ./pkg -run Golden -update): %v", err)
			}
			if string(got) != string(want) {
				t.Errorf("descriptor differs from %s; re-run with -update if the change is intended", path)
			}
		})
	}
}

// The real conformance gate: validate against the DMTF schema (DSP0243 clause
// 493 — "The OVF descriptor shall validate against DSP8023"). The schemas are
// vendored under testdata/xsd with their imports rewritten to local paths so
// this runs offline.
func TestBuildOVF_ValidatesAgainstDSP8023(t *testing.T) {
	if _, err := exec.LookPath("xmllint"); err != nil {
		t.Skip("xmllint not installed; skipping XSD validation")
	}
	schema := filepath.Join("testdata", "xsd", "dsp8023.xsd")

	for _, p := range allProfiles() {
		t.Run(string(p), func(t *testing.T) {
			got, err := BuildOVF(ovfTestInput(), p)
			if err != nil {
				t.Fatalf("BuildOVF: %v", err)
			}
			f := filepath.Join(t.TempDir(), "descriptor.ovf")
			if err := os.WriteFile(f, got, 0o644); err != nil {
				t.Fatal(err)
			}
			out, err := exec.Command("xmllint", "--noout", "--schema", schema, f).CombinedOutput()
			if err != nil {
				t.Errorf("descriptor does not validate against DSP8023:\n%s", out)
			}
		})
	}
}

// ovf:capacityAllocationUnits="byte * 2^20" means MiB. Passing raw bytes inflates
// the disk by ~10^6; rounding down declares a disk smaller than its filesystem,
// which vCenter rejects.
func TestCapacityMiB_RoundsUp(t *testing.T) {
	cases := []struct{ in, want int64 }{
		{0, 0},
		{1, 1},
		{1 << 20, 1},
		{(1 << 20) + 1, 2},
		{53687091200, 51200}, // 50 GiB
		{1073741824, 1024},   // 1 GiB
		{(1 << 30) - 1, 1024},
	}
	for _, c := range cases {
		if got := capacityMiB(c.in); got != c.want {
			t.Errorf("capacityMiB(%d)=%d, want %d", c.in, got, c.want)
		}
	}
}

// The OVF SCSI ResourceSubType and the qemu-img adapter_type describe the same
// controller. If they drift apart, ovftool warns about a mismatch, so pin them.
func TestProfileRules_AdapterTypeMatchesSubType(t *testing.T) {
	for _, p := range allProfiles() {
		r, err := rulesFor(p)
		if err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		if r.qemuAdapterType != "" && r.qemuAdapterType != r.scsiSubType {
			t.Errorf("%s: qemu adapter_type=%q but OVF ResourceSubType=%q; they must match",
				p, r.qemuAdapterType, r.scsiSubType)
		}
		if r.diskFormatURI == "" || r.diskExtension == "" || r.qemuFormat == "" {
			t.Errorf("%s: incomplete disk format rules: %+v", p, r)
		}
	}
}

// qemu-img's VMDK adapter_type accepts only ide|lsilogic|buslogic|legacyESX.
// The faithful profile therefore must not claim to write VMDK.
func TestProfileRules_FaithfulUsesQcow2(t *testing.T) {
	r, err := rulesFor(ProfileFaithful)
	if err != nil {
		t.Fatal(err)
	}
	if r.qemuFormat != "qcow2" || r.diskExtension != ".qcow2" {
		t.Errorf("faithful profile must use qcow2, got format=%q ext=%q", r.qemuFormat, r.diskExtension)
	}
	if r.qemuAdapterType != "" {
		t.Errorf("faithful profile must not set a VMDK adapter_type, got %q", r.qemuAdapterType)
	}
	if !r.preserveVirtio {
		t.Error("faithful profile must preserve virtio")
	}
}

func TestProfileRules_PortableHasNoVendorExtensions(t *testing.T) {
	r, err := rulesFor(ProfilePortable)
	if err != nil {
		t.Fatal(err)
	}
	if r.vmwExtensions {
		t.Error("portable profile must not emit VMware extensions")
	}
	got, err := BuildOVF(ovfTestInput(), ProfilePortable)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), "vmw:") {
		t.Error("portable descriptor contains vmw: markup")
	}
	// OVF 1.0 has no ovf:version attribute on Envelope.
	if strings.Contains(string(got), "ovf:version=") {
		t.Error("portable descriptor (OVF 1.0) must not declare ovf:version")
	}
}

func TestBuildOVF_UnknownProfileRejected(t *testing.T) {
	if _, err := BuildOVF(ovfTestInput(), Profile("nonsense")); err == nil {
		t.Error("expected an error for an unknown profile")
	}
}

func TestBuildOVF_RequiresDisks(t *testing.T) {
	in := ovfTestInput()
	in.Disks = nil
	if _, err := BuildOVF(in, ProfileVMware); err == nil {
		t.Error("expected an error when the VM has no disks")
	}
}

// Two devices must never share an address on the same controller.
func TestBuildOVF_NoAddressCollision(t *testing.T) {
	for _, p := range allProfiles() {
		got, err := BuildOVF(ovfTestInput(), p)
		if err != nil {
			t.Fatal(err)
		}
		items := regexp.MustCompile(`(?s)<Item>(.*?)</Item>`).FindAllStringSubmatch(string(got), -1)
		seen := map[string]string{}
		for _, m := range items {
			parent := rasdField(m[1], "Parent")
			addr := rasdField(m[1], "AddressOnParent")
			name := rasdField(m[1], "ElementName")
			if parent == "" || addr == "" {
				continue
			}
			key := parent + "/" + addr
			if prev, dup := seen[key]; dup {
				t.Errorf("%s: %q and %q both sit at parent=%s address=%s", p, name, prev, parent, addr)
			}
			seen[key] = name
		}
	}
}

// Every Disk must point at a File that exists, and vice versa.
func TestBuildOVF_DiskFileRefsResolve(t *testing.T) {
	got, err := BuildOVF(ovfTestInput(), ProfileVMware)
	if err != nil {
		t.Fatal(err)
	}
	var env struct {
		References struct {
			Files []struct {
				ID   string `xml:"id,attr"`
				Href string `xml:"href,attr"`
			} `xml:"File"`
		} `xml:"References"`
		DiskSection struct {
			Disks []struct {
				DiskID  string `xml:"diskId,attr"`
				FileRef string `xml:"fileRef,attr"`
			} `xml:"Disk"`
		} `xml:"DiskSection"`
	}
	if err := xml.Unmarshal(got, &env); err != nil {
		t.Fatalf("generated descriptor is not parseable: %v", err)
	}
	ids := map[string]bool{}
	for _, f := range env.References.Files {
		ids[f.ID] = true
	}
	if len(env.DiskSection.Disks) != len(ovfTestInput().Disks) {
		t.Fatalf("got %d Disk elements, want %d", len(env.DiskSection.Disks), len(ovfTestInput().Disks))
	}
	for _, d := range env.DiskSection.Disks {
		if !ids[d.FileRef] {
			t.Errorf("Disk %s references missing File %s", d.DiskID, d.FileRef)
		}
	}
}

// A chunked disk must declare ovf:chunkSize; an unchunked one must not.
func TestBuildOVF_ChunkSizeAttribute(t *testing.T) {
	in := ovfTestInput()
	in.Disks = []OVFDisk{
		{Href: "big.vmdk", FileSize: 5 << 30, CapacityBytes: 10 << 30, ChunkSize: defaultChunkSize},
		{Href: "small.vmdk", FileSize: 1 << 20, CapacityBytes: 1 << 30},
	}
	got, err := BuildOVF(in, ProfileVMware)
	if err != nil {
		t.Fatal(err)
	}
	s := string(got)
	if !strings.Contains(s, fmt.Sprintf(`ovf:href="big.vmdk" ovf:size="%d" ovf:chunkSize="%d"`, int64(5)<<30, defaultChunkSize)) {
		t.Error("chunked disk must declare ovf:size (the total) and ovf:chunkSize")
	}
	small := regexp.MustCompile(`<File[^>]*small\.vmdk[^>]*>`).FindString(s)
	if strings.Contains(small, "chunkSize") {
		t.Errorf("unchunked disk must not declare ovf:chunkSize, got %s", small)
	}
}

func TestNicSubType(t *testing.T) {
	vmware, _ := rulesFor(ProfileVMware)
	portable, _ := rulesFor(ProfilePortable)
	faithful, _ := rulesFor(ProfileFaithful)

	cases := []struct {
		model string
		rules profileRules
		want  string
	}{
		{"virtio", vmware, "E1000E"},   // no VMware target implements virtio
		{"virtio", portable, "E1000"},  // E1000 has the widest support
		{"virtio", faithful, "virtio"}, // preserved verbatim
		{"e1000", vmware, "E1000"},
		{"e1000e", vmware, "E1000E"},
		{"", faithful, "virtio"},
	}
	for _, c := range cases {
		if got := nicSubType(c.model, c.rules); got != c.want {
			t.Errorf("nicSubType(%q)=%q, want %q", c.model, got, c.want)
		}
	}
}

func rasdField(item, name string) string {
	m := regexp.MustCompile(`<rasd:` + name + `>(.*?)</rasd:` + name + `>`).FindStringSubmatch(item)
	if m == nil {
		return ""
	}
	return m[1]
}
