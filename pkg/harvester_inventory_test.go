// pkg/harvester_inventory_test.go
package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// vmFixture builds a KubeVirt VirtualMachine shaped like the ones on a real
// Harvester cluster. Captured from `kubectl get vm windows-server-2022 -o json`,
// which is the most awkward real case: a PVC-backed CD-ROM (an attached ISO), a
// containerDisk-backed CD-ROM (the virtio driver disk), a real root disk and a
// cloud-init volume.
func vmFixture() *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "kubevirt.io/v1",
		"kind":       "VirtualMachine",
		"metadata":   map[string]interface{}{"name": "windows-server-2022", "namespace": "labs"},
		"spec": map[string]interface{}{
			"runStrategy": "Halted",
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"architecture": "amd64",
					"domain": map[string]interface{}{
						"cpu":     map[string]interface{}{"cores": int64(2), "sockets": int64(2), "threads": int64(1)},
						"memory":  map[string]interface{}{"guest": "6Gi"},
						"machine": map[string]interface{}{"type": "q35"},
						"devices": map[string]interface{}{
							"disks": []interface{}{
								map[string]interface{}{"name": "cdrom-disk", "bootOrder": int64(1), "cdrom": map[string]interface{}{"bus": "sata"}},
								map[string]interface{}{"name": "rootdisk", "bootOrder": int64(2), "disk": map[string]interface{}{"bus": "virtio"}},
								map[string]interface{}{"name": "virtio-container-disk", "bootOrder": int64(3), "cdrom": map[string]interface{}{"bus": "sata"}},
								map[string]interface{}{"name": "cloudinitdisk", "disk": map[string]interface{}{"bus": "virtio"}},
							},
							"interfaces": []interface{}{
								map[string]interface{}{"name": "default", "model": "e1000", "macAddress": "7a:86:9b:1a:1f:c4"},
							},
						},
					},
					"volumes": []interface{}{
						map[string]interface{}{"name": "cdrom-disk", "persistentVolumeClaim": map[string]interface{}{"claimName": "iso-pvc"}},
						map[string]interface{}{"name": "rootdisk", "persistentVolumeClaim": map[string]interface{}{"claimName": "root-pvc"}},
						map[string]interface{}{"name": "virtio-container-disk", "containerDisk": map[string]interface{}{"image": "virtio-win"}},
						map[string]interface{}{"name": "cloudinitdisk", "cloudInitNoCloud": map[string]interface{}{"secretRef": map[string]interface{}{"name": "s"}}},
					},
				},
			},
		},
	}}
}

func testPVCs() map[string]pvcInfo {
	return map[string]pvcInfo{
		"labs/iso-pvc":  {capacity: 5 << 30, storageClass: "harvester-longhorn", volumeMode: "Block"},
		"labs/root-pvc": {capacity: 50 << 30, storageClass: "harvester-longhorn", volumeMode: "Block"},
	}
}

// A PVC-backed CD-ROM must NOT be exported as a virtual disk, and a
// containerDisk-backed CD-ROM must not either. Conflating the device type with
// the backing kind silently pulls an attached ISO into the OVA and inflates the
// reported disk total.
func TestHarvesterVMToNode_DeviceVsBackingKind(t *testing.T) {
	node := harvesterVMToNode(vmFixture(), map[string]bool{}, testPVCs())

	want := map[string]struct {
		device, kind string
		exportable   bool
	}{
		"cdrom-disk":            {"cdrom", "pvc", false},
		"rootdisk":              {"disk", "pvc", true},
		"virtio-container-disk": {"cdrom", "container", false},
		"cloudinitdisk":         {"disk", "cloudinit", false},
	}
	if len(node.Disks) != len(want) {
		t.Fatalf("got %d disks, want %d", len(node.Disks), len(want))
	}
	for _, d := range node.Disks {
		w, ok := want[d.Name]
		if !ok {
			t.Errorf("unexpected disk %q", d.Name)
			continue
		}
		if d.Device != w.device || d.Kind != w.kind {
			t.Errorf("%s: got device=%q kind=%q, want device=%q kind=%q", d.Name, d.Device, d.Kind, w.device, w.kind)
		}
		if got := isExportableDisk(d); got != w.exportable {
			t.Errorf("%s: isExportableDisk=%v, want %v", d.Name, got, w.exportable)
		}
	}

	// Only the 50Gi root disk counts; the 5Gi ISO must not inflate the total.
	if node.DiskSizeGB != 50 {
		t.Errorf("DiskSizeGB=%d, want 50 (the 5Gi CD-ROM PVC must be excluded)", node.DiskSizeGB)
	}
}

func TestHarvesterVMToNode_SpecMapping(t *testing.T) {
	node := harvesterVMToNode(vmFixture(), map[string]bool{}, testPVCs())

	if node.ID != "labs/windows-server-2022" {
		t.Errorf("ID=%q, want namespace-qualified id", node.ID)
	}
	if node.CPU != 4 { // cores(2) * sockets(2) * threads(1)
		t.Errorf("CPU=%d, want 4 (cores*sockets*threads)", node.CPU)
	}
	if node.MemoryMB != 6144 {
		t.Errorf("MemoryMB=%d, want 6144", node.MemoryMB)
	}
	if node.Firmware != "bios" {
		t.Errorf("Firmware=%q, want bios", node.Firmware)
	}
	if node.MachineType != "q35" || node.Architecture != "amd64" {
		t.Errorf("machine=%q arch=%q, want q35/amd64", node.MachineType, node.Architecture)
	}
	if len(node.Networks) != 1 || node.Networks[0].MAC != "7a:86:9b:1a:1f:c4" {
		t.Errorf("networks not mapped: %+v", node.Networks)
	}
}

// The running check is the feature's most important safety property. Harvester's
// PVCs are ReadWriteMany Block volumes, so an export Job CAN mount and read one
// while the VM runs, silently producing a torn image. Nothing in Kubernetes
// prevents that, so this guard must hold.
func TestExportBlockers_RunningVMIsBlocked(t *testing.T) {
	running := map[string]bool{"labs/windows-server-2022": true}
	node := harvesterVMToNode(vmFixture(), running, testPVCs())

	if node.PowerState != "poweredOn" {
		t.Errorf("PowerState=%q, want poweredOn", node.PowerState)
	}
	if len(node.ExportBlockers) == 0 {
		t.Fatal("a running VM must be blocked from export")
	}
}

// If the VMI list fails we cannot know which VMs are running, so every VM must be
// treated as running. Failing closed blocks an export; failing open corrupts one.
func TestExportBlockers_UnknownRunStateFailsClosed(t *testing.T) {
	node := harvesterVMToNode(vmFixture(), nil, testPVCs())
	if len(node.ExportBlockers) == 0 {
		t.Fatal("with unknown VMI state the VM must be treated as running and blocked")
	}
}

func TestExportBlockers_StoppedVMIsExportable(t *testing.T) {
	node := harvesterVMToNode(vmFixture(), map[string]bool{}, testPVCs())
	if len(node.ExportBlockers) != 0 {
		t.Errorf("stopped VM should be exportable, got blockers: %v", node.ExportBlockers)
	}
}

func TestExportBlockers_NonAmd64AndNoDisks(t *testing.T) {
	vm := vmFixture()
	unstructured.SetNestedField(vm.Object, "arm64", "spec", "template", "spec", "architecture")
	node := harvesterVMToNode(vm, map[string]bool{}, testPVCs())
	if !hasBlockerContaining(node.ExportBlockers, "arm64") {
		t.Errorf("arm64 VM must be blocked, got: %v", node.ExportBlockers)
	}

	// A VM whose only volumes are cloud-init has nothing to export.
	vm2 := vmFixture()
	unstructured.SetNestedSlice(vm2.Object, []interface{}{
		map[string]interface{}{"name": "cloudinitdisk", "disk": map[string]interface{}{"bus": "virtio"}},
	}, "spec", "template", "spec", "domain", "devices", "disks")
	node2 := harvesterVMToNode(vm2, map[string]bool{}, testPVCs())
	if !hasBlockerContaining(node2.ExportBlockers, "no PVC-backed disks") {
		t.Errorf("VM with no exportable disks must be blocked, got: %v", node2.ExportBlockers)
	}
}

func hasBlockerContaining(blockers []string, substr string) bool {
	for _, b := range blockers {
		if strings.Contains(b, substr) {
			return true
		}
	}
	return false
}

func TestParseQuantityBytes(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"2Gi", 2 << 30},
		{"1365Mi", 1365 << 20},
		{"512M", 512 * 1000 * 1000},
		{"1073741824", 1073741824},
		{"6Gi", 6 << 30},
		{"garbage", 0},
	}
	for _, c := range cases {
		if got := parseQuantityBytes(c.in); got != c.want {
			t.Errorf("parseQuantityBytes(%q)=%d, want %d", c.in, got, c.want)
		}
	}
}
