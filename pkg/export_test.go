// pkg/export_test.go
package main

import (
	"path/filepath"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func testExportSpec() ExportSpec {
	return ExportSpec{
		ExportID:    "abc123",
		VMNamespace: "labs",
		VMName:      "sles15sp6",
		TargetName:  "sles15sp6-abc123",
		Profile:     string(ProfileVMware),
		Disks: []ExportDiskSpec{
			{DevicePath: "/dev/vmdisk0", CapacityBytes: 53687091200, BusType: "virtio", BootOrder: 1},
		},
		OVF: OVFInput{Name: "sles15sp6", CPUs: 2, MemoryMB: 2048},
	}
}

func TestBuildExportJob_MountsDisksAsReadOnlyBlockDevices(t *testing.T) {
	job, err := buildExportJob(testExportSpec(), ExportJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports", SourceClaims: []string{"sles15sp6-disk-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	pod := job.Spec.Template.Spec

	if len(pod.Containers[0].VolumeDevices) != 1 {
		t.Fatalf("expected 1 volumeDevice, got %d", len(pod.Containers[0].VolumeDevices))
	}
	if got := pod.Containers[0].VolumeDevices[0].DevicePath; got != "/dev/vmdisk0" {
		t.Errorf("devicePath=%q, want /dev/vmdisk0", got)
	}

	var src *corev1.Volume
	for i := range pod.Volumes {
		if pod.Volumes[i].Name == "srcdisk0" {
			src = &pod.Volumes[i]
		}
	}
	if src == nil {
		t.Fatal("no srcdisk0 volume")
	}
	if src.PersistentVolumeClaim.ClaimName != "sles15sp6-disk-1" {
		t.Errorf("claim=%q", src.PersistentVolumeClaim.ClaimName)
	}
	// Source disks must never be writable: this is a read-only export.
	if !src.PersistentVolumeClaim.ReadOnly {
		t.Error("source PVC must be mounted readOnly")
	}
}

// The worker gets its whole instruction set via env and volumes, so it must not
// receive an API token.
func TestBuildExportJob_NoServiceAccountToken(t *testing.T) {
	job, err := buildExportJob(testExportSpec(), ExportJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports", SourceClaims: []string{"c"},
	})
	if err != nil {
		t.Fatal(err)
	}
	am := job.Spec.Template.Spec.AutomountServiceAccountToken
	if am == nil || *am {
		t.Error("export Job must set automountServiceAccountToken: false")
	}
}

// A retry re-reads and re-converts every byte; surfacing the failure is better.
func TestBuildExportJob_NeverRetries(t *testing.T) {
	job, err := buildExportJob(testExportSpec(), ExportJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports", SourceClaims: []string{"c"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.Spec.BackoffLimit == nil || *job.Spec.BackoffLimit != 0 {
		t.Error("backoffLimit must be 0")
	}
	if job.Spec.ActiveDeadlineSeconds == nil || *job.Spec.ActiveDeadlineSeconds <= 0 {
		t.Error("activeDeadlineSeconds must be set")
	}
}

func TestBuildExportJob_SpecRoundTrips(t *testing.T) {
	spec := testExportSpec()
	job, err := buildExportJob(spec, ExportJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports", SourceClaims: []string{"c"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var found string
	for _, e := range job.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "EXPORT_SPEC" {
			found = e.Value
		}
	}
	if found == "" {
		t.Fatal("EXPORT_SPEC not set")
	}
	for _, want := range []string{`"exportId":"abc123"`, `"vmName":"sles15sp6"`, `"devicePath":"/dev/vmdisk0"`} {
		if !strings.Contains(found, want) {
			t.Errorf("EXPORT_SPEC missing %s", want)
		}
	}
	if job.Labels[exportLabelID] != "abc123" {
		t.Error("the export id must be a label so the Job is findable")
	}
}

func TestBuildExportJob_RequiresExportStorage(t *testing.T) {
	_, err := buildExportJob(testExportSpec(), ExportJobOptions{
		Namespace: "labs", Image: "img:1", SourceClaims: []string{"c"},
	})
	if err == nil || !strings.Contains(err.Error(), "export storage") {
		t.Errorf("expected a clear error when no export PVC is configured, got %v", err)
	}
}

// Export target names come from user input and are used to build filesystem
// paths, so traversal must be impossible.
func TestSafeExportPath(t *testing.T) {
	root := "/export"
	ok := []string{"vm.ova", ".vm-import-ui/abc/status.json", "a-b_c.ova"}
	for _, rel := range ok {
		got, err := safeExportPath(root, rel)
		if err != nil {
			t.Errorf("safeExportPath(%q) unexpected error: %v", rel, err)
		}
		if !strings.HasPrefix(got, root+"/") {
			t.Errorf("safeExportPath(%q)=%q escaped the root", rel, got)
		}
	}
	bad := []string{"../etc/passwd", "../../root/.ssh/id_rsa", "a/../../b", "/etc/passwd"}
	for _, rel := range bad {
		if got, err := safeExportPath(root, rel); err == nil {
			// filepath.Join cleans "/etc/passwd" into the root, which is safe;
			// anything that genuinely escapes must be rejected.
			if !strings.HasPrefix(filepath.Clean(got), root) {
				t.Errorf("safeExportPath(%q)=%q escaped the root without error", rel, got)
			}
		}
	}
	if _, err := safeExportPath("", "x"); err == nil {
		t.Error("an unset export root must be an error")
	}
}

func TestSlugifyName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"sles15sp6", "sles15sp6"},
		{"SLES 16", "sles-16"},
		{"VMDEVOPSTSTWIN01", "vmdevopststwin01"},
		{"my.vm_name", "my-vm-name"},
		{"---", "vm"},
		{"", "vm"},
	}
	for _, c := range cases {
		if got := slugifyName(c.in); got != c.want {
			t.Errorf("slugifyName(%q)=%q, want %q", c.in, got, c.want)
		}
	}
	if len(slugifyName(strings.Repeat("a", 100))) > 40 {
		t.Error("slug must be truncated to a sane length")
	}
}

func TestQemuOutputOpts(t *testing.T) {
	vmware, _ := rulesFor(ProfileVMware)
	if got := qemuOutputOpts(vmware); got != "subformat=streamOptimized,adapter_type=lsilogic" {
		t.Errorf("vmware opts=%q", got)
	}
	faithful, _ := rulesFor(ProfileFaithful)
	if got := qemuOutputOpts(faithful); got != "" {
		t.Errorf("qcow2 needs no vmdk options, got %q", got)
	}
}

// The export Job must default to running as root. Source disks arrive as block
// devices owned by root:disk, and a freshly provisioned RWX volume is root-owned
// and mode 755, so the image's default UID 1001 cannot write to it.
//
// Regression: these defaults were nil when the env vars were unset, so a Job got
// an empty securityContext and failed with
// "mkdir /export/.vm-import-ui: permission denied" — but only outside a chart
// install, since the chart set them explicitly.
func TestLoadExportConfig_DefaultsToRootForBlockDeviceAccess(t *testing.T) {
	for _, k := range []string{"EXPORT_RUN_AS_USER", "EXPORT_FS_GROUP"} {
		t.Setenv(k, "")
	}
	c := loadExportConfig()
	if c.RunAsUser == nil || *c.RunAsUser != 0 {
		t.Errorf("RunAsUser = %v, want 0: the worker must be able to read block devices", c.RunAsUser)
	}
	if c.FSGroup == nil || *c.FSGroup != 0 {
		t.Errorf("FSGroup = %v, want 0: the worker must be able to write to the export volume", c.FSGroup)
	}

	// And the Job actually carries them.
	job, err := buildExportJob(testExportSpec(), ExportJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports",
		SourceClaims: []string{"c"}, RunAsUser: c.RunAsUser, FSGroup: c.FSGroup,
	})
	if err != nil {
		t.Fatal(err)
	}
	sc := job.Spec.Template.Spec.SecurityContext
	if sc == nil || sc.RunAsUser == nil || *sc.RunAsUser != 0 {
		t.Error("the Job's pod securityContext must set runAsUser: 0")
	}
}

func TestLoadExportConfig_RespectsOverrides(t *testing.T) {
	t.Setenv("EXPORT_RUN_AS_USER", "1001")
	t.Setenv("EXPORT_FS_GROUP", "2000")
	c := loadExportConfig()
	if c.RunAsUser == nil || *c.RunAsUser != 1001 {
		t.Errorf("RunAsUser = %v, want 1001", c.RunAsUser)
	}
	if c.FSGroup == nil || *c.FSGroup != 2000 {
		t.Errorf("FSGroup = %v, want 2000", c.FSGroup)
	}
}
