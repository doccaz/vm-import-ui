// pkg/harvester_inventory.go
//
// Cluster-wide Harvester/KubeVirt VM inventory, shaped as the same InventoryNode
// tree the vCenter explorer already renders (Cluster -> Namespace -> VirtualMachine),
// so the existing React tree components can be reused unchanged.
//
// This feeds the VM Export page. See docs/architecture-notes.md.
package main

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	log "github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var vmiGVRKubevirt = schema.GroupVersionResource{
	Group:    "kubevirt.io",
	Version:  "v1",
	Resource: "virtualmachineinstances",
}

// pvcInfo is the subset of a PersistentVolumeClaim the export flow cares about.
type pvcInfo struct {
	capacity     int64
	storageClass string
	volumeMode   string
}

// HandleGetHarvesterInventory returns the whole cluster's KubeVirt VMs as an
// InventoryNode tree. It is read-only and best-effort: a namespace that fails to
// list is logged and skipped rather than failing the whole request.
func HandleGetHarvesterInventory(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		vms, err := clients.Dynamic.Resource(vmGVR).Namespace("").List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Errorf("Failed to list VirtualMachines: %v", err)
			respondWithError(w, http.StatusInternalServerError, "Failed to list VirtualMachines: "+err.Error())
			return
		}

		running := runningVMNames(ctx, clients)
		pvcs := pvcIndex(ctx, clients)

		byNamespace := map[string][]InventoryNode{}
		for i := range vms.Items {
			vm := &vms.Items[i]
			node := harvesterVMToNode(vm, running, pvcs)
			byNamespace[vm.GetNamespace()] = append(byNamespace[vm.GetNamespace()], node)
		}

		namespaces := make([]string, 0, len(byNamespace))
		for ns := range byNamespace {
			namespaces = append(namespaces, ns)
		}
		sort.Strings(namespaces)

		root := InventoryNode{ID: "harvester", Name: "Harvester Cluster", Type: "datacenter"}
		for _, ns := range namespaces {
			children := byNamespace[ns]
			sort.Slice(children, func(a, b int) bool { return children[a].Name < children[b].Name })
			root.Children = append(root.Children, InventoryNode{
				ID:       "ns/" + ns,
				Name:     ns,
				Type:     "namespace",
				Children: children,
			})
		}

		log.Debugf("Built Harvester inventory: %d namespaces, %d VMs", len(namespaces), len(vms.Items))
		respondWithJSON(w, http.StatusOK, root)
	}
}

// runningVMNames returns the set of "namespace/name" that currently have a VMI.
// A VMI existing is the authoritative signal that a VM's volumes are in use and
// therefore MUST NOT be read for export.
func runningVMNames(ctx context.Context, clients *K8sClients) map[string]bool {
	out := map[string]bool{}
	list, err := clients.Dynamic.Resource(vmiGVRKubevirt).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		// Best-effort: without VMI data every VM is treated as running, which is
		// the safe direction (it blocks export rather than corrupting an image).
		log.Warnf("Failed to list VirtualMachineInstances, treating all VMs as running: %v", err)
		return nil
	}
	for _, vmi := range list.Items {
		out[vmi.GetNamespace()+"/"+vmi.GetName()] = true
	}
	return out
}

// pvcIndex maps "namespace/name" to the PVC details the export needs.
func pvcIndex(ctx context.Context, clients *K8sClients) map[string]pvcInfo {
	out := map[string]pvcInfo{}
	list, err := clients.Clientset.CoreV1().PersistentVolumeClaims("").List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Warnf("Failed to list PersistentVolumeClaims, disk sizes will be unknown: %v", err)
		return out
	}
	for i := range list.Items {
		p := &list.Items[i]
		info := pvcInfo{}
		if q, ok := p.Spec.Resources.Requests["storage"]; ok {
			info.capacity = q.Value()
		}
		if p.Spec.StorageClassName != nil {
			info.storageClass = *p.Spec.StorageClassName
		}
		if p.Spec.VolumeMode != nil {
			info.volumeMode = string(*p.Spec.VolumeMode)
		}
		out[p.Namespace+"/"+p.Name] = info
	}
	return out
}

// harvesterVMToNode flattens one KubeVirt VirtualMachine into an InventoryNode.
func harvesterVMToNode(vm *unstructured.Unstructured, running map[string]bool, pvcs map[string]pvcInfo) InventoryNode {
	ns, name := vm.GetNamespace(), vm.GetName()
	key := ns + "/" + name

	node := InventoryNode{
		ID:        key,
		Name:      name,
		Type:      "VirtualMachine",
		Namespace: ns,
		Folder:    ns,
	}

	// running == nil means the VMI list failed; assume running (safe direction).
	isRunning := running == nil || running[key]
	if isRunning {
		node.PowerState = "poweredOn"
	} else {
		node.PowerState = "poweredOff"
	}

	node.RunStrategy, _, _ = unstructured.NestedString(vm.Object, "spec", "runStrategy")

	spec, _, _ := unstructured.NestedMap(vm.Object, "spec", "template", "spec")
	if spec == nil {
		node.ExportBlockers = append(node.ExportBlockers, "VM has no template spec")
		return node
	}
	node.Architecture, _, _ = unstructured.NestedString(spec, "architecture")

	domain, _, _ := unstructured.NestedMap(spec, "domain")
	if domain != nil {
		node.CPU = vcpuCount(domain)
		node.MemoryMB = memoryMB(domain)
		node.MachineType, _, _ = unstructured.NestedString(domain, "machine", "type")
		node.Firmware = firmwareKind(domain)
		node.Disks = harvesterDisks(domain, spec, ns, pvcs)
		node.Networks = harvesterNetworks(domain)
	}

	var totalBytes int64
	for _, d := range node.Disks {
		if isExportableDisk(d) {
			totalBytes += d.Capacity
		}
	}
	node.DiskSizeGB = totalBytes / (1024 * 1024 * 1024)

	node.ExportBlockers = exportBlockers(&node, isRunning)
	return node
}

// vcpuCount is cores*sockets*threads, defaulting each to 1, falling back to the
// CPU resource request when domain.cpu is absent.
func vcpuCount(domain map[string]interface{}) int32 {
	cpu, _, _ := unstructured.NestedMap(domain, "cpu")
	if cpu == nil {
		return 0
	}
	get := func(k string) int64 {
		v, found, err := unstructured.NestedInt64(cpu, k)
		if !found || err != nil || v <= 0 {
			return 1
		}
		return v
	}
	return int32(get("cores") * get("sockets") * get("threads"))
}

// memoryMB prefers domain.memory.guest and falls back to the memory request.
func memoryMB(domain map[string]interface{}) int32 {
	if s, found, _ := unstructured.NestedString(domain, "memory", "guest"); found && s != "" {
		return int32(parseQuantityBytes(s) / (1024 * 1024))
	}
	if s, found, _ := unstructured.NestedString(domain, "resources", "requests", "memory"); found && s != "" {
		return int32(parseQuantityBytes(s) / (1024 * 1024))
	}
	return 0
}

// firmwareKind reports "efi" when an EFI bootloader is configured, else "bios".
func firmwareKind(domain map[string]interface{}) string {
	if _, found, _ := unstructured.NestedMap(domain, "firmware", "bootloader", "efi"); found {
		return "efi"
	}
	return "bios"
}

// harvesterDisks correlates domain.devices.disks with spec.volumes so each disk
// carries its backing kind and, for PVCs, its real capacity.
func harvesterDisks(domain, spec map[string]interface{}, ns string, pvcs map[string]pvcInfo) []VMDisk {
	disks, _, _ := unstructured.NestedSlice(domain, "devices", "disks")
	volumes, _, _ := unstructured.NestedSlice(spec, "volumes")

	// volume name -> backing kind and PVC claim name
	kindByVolume := map[string]string{}
	claimByVolume := map[string]string{}
	for _, raw := range volumes {
		v, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		vname, _, _ := unstructured.NestedString(v, "name")
		switch {
		case hasKey(v, "persistentVolumeClaim"):
			kindByVolume[vname] = "pvc"
			claimByVolume[vname], _, _ = unstructured.NestedString(v, "persistentVolumeClaim", "claimName")
		case hasKey(v, "dataVolume"):
			kindByVolume[vname] = "pvc"
			claimByVolume[vname], _, _ = unstructured.NestedString(v, "dataVolume", "name")
		case hasKey(v, "cloudInitNoCloud"), hasKey(v, "cloudInitConfigDrive"):
			kindByVolume[vname] = "cloudinit"
		case hasKey(v, "containerDisk"):
			kindByVolume[vname] = "container"
		default:
			kindByVolume[vname] = "other"
		}
	}

	out := make([]VMDisk, 0, len(disks))
	for i, raw := range disks {
		d, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name, _, _ := unstructured.NestedString(d, "name")
		// Device type (disk/cdrom/lun) and backing kind (pvc/cloudinit/...) are
		// independent: a CD-ROM can be PVC-backed (an attached ISO) or
		// containerDisk-backed (e.g. the virtio driver disk on Windows guests).
		disk := VMDisk{Name: name, UnitNum: int32(i), Kind: kindByVolume[name], Device: "disk"}

		if bus, found, _ := unstructured.NestedString(d, "disk", "bus"); found {
			disk.BusType = bus
		} else if bus, found, _ := unstructured.NestedString(d, "cdrom", "bus"); found {
			disk.BusType = bus
			disk.Device = "cdrom"
		} else if bus, found, _ := unstructured.NestedString(d, "lun", "bus"); found {
			disk.BusType = bus
			disk.Device = "lun"
		}
		if bo, found, _ := unstructured.NestedInt64(d, "bootOrder"); found {
			disk.BootOrder = int32(bo)
		}
		if claim := claimByVolume[name]; claim != "" {
			disk.PVCName = claim
			if info, ok := pvcs[ns+"/"+claim]; ok {
				disk.Capacity = info.capacity
				disk.StorageClass = info.storageClass
				disk.VolumeMode = info.volumeMode
			}
		}
		out = append(out, disk)
	}
	return out
}

// harvesterNetworks flattens domain.devices.interfaces.
func harvesterNetworks(domain map[string]interface{}) []VMNetwork {
	ifaces, _, _ := unstructured.NestedSlice(domain, "devices", "interfaces")
	out := make([]VMNetwork, 0, len(ifaces))
	for i, raw := range ifaces {
		n, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name, _, _ := unstructured.NestedString(n, "name")
		mac, _, _ := unstructured.NestedString(n, "macAddress")
		model, _, _ := unstructured.NestedString(n, "model")
		out = append(out, VMNetwork{Name: name, ID: model, MAC: mac, Key: int32(i)})
	}
	return out
}

// exportBlockers lists the reasons this VM cannot be exported right now. An empty
// result means the VM is exportable.
//
// The running check is the important one: Harvester's PVCs are ReadWriteMany Block
// volumes, so a Job CAN mount and read one while the VM runs — producing a torn,
// inconsistent image with no error. Nothing in Kubernetes prevents this, so it is
// enforced here and re-checked before the export Job starts.
func exportBlockers(node *InventoryNode, isRunning bool) []string {
	var blockers []string
	if isRunning {
		blockers = append(blockers, "VM is running: power it off, or enable the snapshot option to export a crash-consistent copy")
	}
	if node.Architecture != "" && node.Architecture != "amd64" {
		blockers = append(blockers, "unsupported architecture "+node.Architecture+": OVF export supports amd64 only")
	}
	var exportable int
	for _, d := range node.Disks {
		if isExportableDisk(d) {
			exportable++
		}
	}
	if exportable == 0 {
		blockers = append(blockers, "VM has no PVC-backed disks to export")
	}
	return blockers
}

// isExportableDisk reports whether a disk contributes a virtual disk to the OVA.
// Only PVC-backed disks qualify: CD-ROMs become empty drives in the descriptor,
// containerDisks are image layers rather than VM state, and cloud-init volumes are
// deliberately excluded because they carry credentials.
func isExportableDisk(d VMDisk) bool {
	return d.Kind == "pvc" && d.Device == "disk"
}

func hasKey(m map[string]interface{}, k string) bool {
	_, ok := m[k]
	return ok
}

// parseQuantityBytes parses the Kubernetes quantity subset KubeVirt emits for
// memory (e.g. "2Gi", "1365Mi", "512M", "1073741824").
func parseQuantityBytes(s string) int64 {
	s = strings.TrimSpace(s)
	suffixes := []struct {
		suffix string
		mult   int64
	}{
		{"Ki", 1 << 10}, {"Mi", 1 << 20}, {"Gi", 1 << 30}, {"Ti", 1 << 40},
		{"K", 1000}, {"M", 1000 * 1000}, {"G", 1000 * 1000 * 1000}, {"T", 1000 * 1000 * 1000 * 1000},
	}
	for _, x := range suffixes {
		if strings.HasSuffix(s, x.suffix) {
			n, err := strconv.ParseFloat(strings.TrimSuffix(s, x.suffix), 64)
			if err != nil {
				log.Warnf("Could not parse quantity %q: %v", s, err)
				return 0
			}
			return int64(n * float64(x.mult))
		}
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		log.Warnf("Could not parse quantity %q: %v", s, err)
		return 0
	}
	return n
}
