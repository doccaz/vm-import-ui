// pkg/ova_e2e_test.go
//
// End-to-end assembly checks against independent, third-party readers.
//
// XSD validation (ovf_test.go) proves the descriptor is schema-correct, but not
// that a real consumer agrees with our interpretation of it — units, device
// mapping and manifest digests are all things a schema cannot catch. virt-v2v is
// an entirely separate OVF implementation, so agreement here is real evidence.
//
// Both tests skip cleanly when the tools are absent, so CI without qemu-img or
// libguestfs still passes.
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// buildRealOVA produces a genuine OVA containing a real stream-optimized VMDK.
func buildRealOVA(t *testing.T, dir string, p Profile) string {
	t.Helper()

	raw := filepath.Join(dir, "disk.raw")
	if err := os.WriteFile(raw, make([]byte, 16<<20), 0o644); err != nil {
		t.Fatal(err)
	}

	rules, err := rulesFor(p)
	if err != nil {
		t.Fatal(err)
	}
	disk := filepath.Join(dir, "disk-0"+rules.diskExtension)
	args := []string{"convert", "-f", "raw", "-O", rules.qemuFormat}
	if opts := qemuOutputOpts(rules); opts != "" {
		args = append(args, "-o", opts)
	}
	args = append(args, raw, disk)
	if out, err := exec.Command("qemu-img", args...).CombinedOutput(); err != nil {
		t.Fatalf("qemu-img %v: %v\n%s", args, err, out)
	}

	st, err := os.Stat(disk)
	if err != nil {
		t.Fatal(err)
	}
	in := OVFInput{
		Name: "testvm", Namespace: "labs", CPUs: 2, MemoryMB: 1024,
		Firmware: "bios", MachineType: "q35", Architecture: "amd64",
		Disks: []OVFDisk{{
			Href:          "disk-0" + rules.diskExtension,
			FileSize:      st.Size(),
			CapacityBytes: 16 << 20,
			BusType:       "virtio",
		}},
		Networks:     []OVFNetwork{{Name: "default", Model: "virtio", MAC: "82:c7:54:0f:c6:08"}},
		PreserveMACs: true,
	}
	descriptor, err := BuildOVF(in, p)
	if err != nil {
		t.Fatal(err)
	}

	files := []OvaFile{{Name: in.Disks[0].Href, Size: st.Size(), OpenAt: LocalFile(disk)}}
	chunks, _, err := PlanChunks(files, defaultChunkSize)
	if err != nil {
		t.Fatal(err)
	}
	chunks, err = HashChunks(chunks)
	if err != nil {
		t.Fatal(err)
	}

	ova := filepath.Join(dir, "testvm.ova")
	f, err := os.Create(ova)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := WriteOVA(f, "testvm", descriptor, chunks); err != nil {
		t.Fatal(err)
	}
	return ova
}

func requireTools(t *testing.T, tools ...string) {
	t.Helper()
	for _, tool := range tools {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed; skipping", tool)
		}
	}
}

// virt-v2v is an independent OVF implementation. If it reads back the values we
// encoded, our interpretation of the spec matches someone else's.
func TestOVA_ReadableByVirtV2V(t *testing.T) {
	requireTools(t, "qemu-img", "virt-v2v")

	for _, tc := range []struct {
		profile Profile
		wantNIC string
	}{
		{ProfileVMware, "e1000e"},
		{ProfilePortable, "e1000"},
	} {
		t.Run(string(tc.profile), func(t *testing.T) {
			ova := buildRealOVA(t, t.TempDir(), tc.profile)
			out, err := exec.Command("virt-v2v", "-i", "ova", ova, "--print-source").CombinedOutput()
			if err != nil {
				t.Fatalf("virt-v2v could not read the OVA: %v\n%s", err, out)
			}
			got := string(out)

			// 1024 MiB must come back as exactly 1073741824 bytes. This is the
			// check that catches a byte-vs-MiB mix-up in AllocationUnits, which
			// no schema can detect.
			for _, want := range []string{
				"source name: testvm",
				"memory: 1073741824",
				"nr vCPUs: 2",
				"82:c7:54:0f:c6:08",
				tc.wantNIC,
			} {
				if !strings.Contains(got, want) {
					t.Errorf("virt-v2v output missing %q:\n%s", want, got)
				}
			}
		})
	}
}

// Prove the manifest is actually load-bearing: corrupt a digest and virt-v2v
// must refuse the package. Without this, a passing read tells us nothing about
// whether our digests were checked at all.
func TestOVA_CorruptManifestIsRejected(t *testing.T) {
	requireTools(t, "qemu-img", "virt-v2v", "tar")

	dir := t.TempDir()
	ova := buildRealOVA(t, dir, ProfileVMware)

	unpacked := filepath.Join(dir, "unpacked")
	if err := os.Mkdir(unpacked, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("tar", "xf", ova, "-C", unpacked).CombinedOutput(); err != nil {
		t.Fatalf("tar xf: %v\n%s", err, out)
	}

	mfPath := filepath.Join(unpacked, "testvm.mf")
	mf, err := os.ReadFile(mfPath)
	if err != nil {
		t.Fatal(err)
	}
	// Flip one hex digit of the disk's digest.
	lines := strings.Split(strings.TrimSuffix(string(mf), "\n"), "\n")
	for i, l := range lines {
		if strings.Contains(l, "disk-0") {
			idx := strings.Index(l, "= ") + 2
			flipped := "a"
			if l[idx] == 'a' {
				flipped = "b"
			}
			lines[i] = l[:idx] + flipped + l[idx+1:]
		}
	}
	if err := os.WriteFile(mfPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	corrupt := filepath.Join(dir, "corrupt.ova")
	cmd := exec.Command("tar", "cf", corrupt, "--format=ustar", "testvm.ovf", "testvm.mf", "disk-0.vmdk")
	cmd.Dir = unpacked
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("tar cf: %v\n%s", err, out)
	}

	out, err := exec.Command("virt-v2v", "-i", "ova", corrupt, "--print-source").CombinedOutput()
	if err == nil {
		t.Fatal("virt-v2v accepted an OVA with a corrupt manifest; the digests are not being verified")
	}
	if !strings.Contains(string(out), "checksum") {
		t.Errorf("expected a checksum error, got:\n%s", out)
	}
}

// TestVMDK_ReadableByVMwareVDDK validates our converted disks with VMware's own
// disk library, via the VDDK container image.
//
// This closes a gap that neither XSD validation nor virt-v2v can: a flawless OVF
// descriptor wrapped around a VMDK that VMware cannot open is still useless on
// ESXi. The VDDK is proprietary and MAY NOT BE REDISTRIBUTED - the image is
// referenced by env var and never vendored or built here - so this test is
// opt-in:
//
//	VDDK_IMAGE=ghcr.io/you/vddk-sle-bci:v8.0.3-11 go test ./pkg -run VDDK
//
// Note VDDK does NOT contain ovftool - it ships only vddkReporter, vixDiskCheck
// and vmware-vdiskmanager. ovftool is a separate Broadcom product.
func TestVMDK_ReadableByVMwareVDDK(t *testing.T) {
	image := os.Getenv("VDDK_IMAGE")
	if image == "" {
		t.Skip("VDDK_IMAGE not set; skipping VMware disk-library validation")
	}
	requireTools(t, "qemu-img", "podman")

	dir := t.TempDir()
	if err := os.Chmod(dir, 0o777); err != nil {
		t.Fatal(err)
	}
	raw := filepath.Join(dir, "disk.raw")
	if err := os.WriteFile(raw, make([]byte, 16<<20), 0o666); err != nil {
		t.Fatal(err)
	}

	rules, err := rulesFor(ProfileVMware)
	if err != nil {
		t.Fatal(err)
	}
	disk := filepath.Join(dir, "stream.vmdk")
	out, err := exec.Command("qemu-img", "convert", "-f", "raw", "-O", rules.qemuFormat,
		"-o", qemuOutputOpts(rules), raw, disk).CombinedOutput()
	if err != nil {
		t.Fatalf("qemu-img: %v\n%s", err, out)
	}
	if err := os.Chmod(disk, 0o666); err != nil {
		t.Fatal(err)
	}

	// vmware-vdiskmanager -R exits 0 for a disk its library can open and parse.
	check := func(name string) int {
		script := "export LD_LIBRARY_PATH=/vmware-vix-disklib-distrib/lib64; " +
			"/vmware-vix-disklib-distrib/bin64/vmware-vdiskmanager -R /data/" + name
		cmd := exec.Command("podman", "run", "--rm", "--user", "0",
			"-v", dir+":/data:z", "--entrypoint", "/bin/sh", image, "-c", script)
		if err := cmd.Run(); err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				return ee.ExitCode()
			}
			t.Fatalf("running podman: %v", err)
		}
		return 0
	}

	if rc := check("stream.vmdk"); rc != 0 {
		t.Errorf("VMware's disk library rejected our stream-optimized VMDK (exit %d)", rc)
	}

	// Negative control: without it, a tool that always exits 0 would look like a
	// pass. Corrupt the header and require rejection.
	broken, err := os.ReadFile(disk)
	if err != nil {
		t.Fatal(err)
	}
	copy(broken, []byte("GARBAGE_HEADER_XX"))
	brokenPath := filepath.Join(dir, "broken.vmdk")
	if err := os.WriteFile(brokenPath, broken, 0o666); err != nil {
		t.Fatal(err)
	}
	if rc := check("broken.vmdk"); rc == 0 {
		t.Error("VMware's disk library accepted a corrupted VMDK; this check is not discriminating")
	}
}

// TestOVA_ValidatesWithOvftool runs VMware's own OVF Tool over a real OVA.
//
// This is the only check that exercises VMware's vendor-specific descriptor
// rules. Empirically established about ovftool 5.1.0:
//
//   - "--schemaValidate" performs real schema validation. On a descriptor with
//     RASD children out of their CIM xs:sequence order it fails with
//     "Line NN: Unsupported element 'ResourceSubType'" - the same line and
//     element that xmllint reports, so the vendored-XSD test is a faithful proxy.
//   - The plain probe verifies the *descriptor's* SHA256 against the manifest,
//     but NOT the disks': corrupting a disk digest is not detected, because
//     probing never reads the disk data. virt-v2v does check disk digests, which
//     is why both tests exist.
//   - "OVF version" in the probe output comes from the envelope namespace, not
//     the ovf:version attribute; setting ovf:version to 2.0 still reports 1.0.
//
// ovftool is proprietary Broadcom software that MAY NOT BE REDISTRIBUTED. It is
// never vendored, never fetched by the build, and never added to the container
// image; it is only ever used from a developer's own installation. Hence the
// skip-unless-present guard.
func TestOVA_ValidatesWithOvftool(t *testing.T) {
	requireTools(t, "qemu-img", "ovftool")

	for _, tc := range []struct {
		profile Profile
		want    []string
	}{
		{ProfileVMware, []string{
			"Name:               testvm",
			"vmx-15", // VirtualSystemType survived
			"Number of CPUs:   2",
			"Memory:           1024.00 MB", // byte * 2^20 handled correctly
			"Capacity:       16.00 MB",     // ovf:capacity in MiB, rounded up
			"SCSI-lsilogic",                // ResourceSubType matches qemu adapter_type
			"E1000E",                       // virtio remapped for VMware
		}},
		{ProfilePortable, []string{
			"Name:               testvm",
			"Number of CPUs:   2",
			"Memory:           1024.00 MB",
			"SCSI-lsilogic",
			"E1000", // portable uses the more widely supported adapter
		}},
	} {
		t.Run(string(tc.profile), func(t *testing.T) {
			ova := buildRealOVA(t, t.TempDir(), tc.profile)

			if out, err := exec.Command("ovftool", "--schemaValidate", ova).CombinedOutput(); err != nil {
				t.Fatalf("ovftool --schemaValidate rejected the OVA: %v\n%s", err, out)
			}

			out, err := exec.Command("ovftool", ova).CombinedOutput()
			if err != nil {
				t.Fatalf("ovftool could not read the OVA: %v\n%s", err, out)
			}
			got := string(out)

			// Assert the values ovftool actually parsed, not just the exit code:
			// a descriptor can exit 0 while meaning something quite different
			// from what we intended.
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("ovftool output missing %q:\n%s", want, got)
				}
			}
			if strings.Contains(got, "Warning:") {
				t.Errorf("ovftool reported warnings (the goal is zero):\n%s", got)
			}
		})
	}
}
