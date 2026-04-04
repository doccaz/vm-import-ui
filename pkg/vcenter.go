// pkg/vcenter.go
package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	log "github.com/sirupsen/logrus"
	"github.com/vmware/govmomi"
	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/property"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/types"
)

func formatDiskSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// VMDisk represents a virtual disk in vCenter
type VMDisk struct {
	Name     string `json:"name"`
	Capacity int64  `json:"capacity"` // in bytes
	BusType  string `json:"busType"`  // e.g. scsi, ide, sata, nvme
	UnitNum  int32  `json:"unitNum"`
}

// VMNetwork represents a network interface in vCenter
type VMNetwork struct {
	Name string `json:"name"`
	ID   string `json:"id"`
	MAC  string `json:"mac"`
	Key  int32  `json:"key"`
}

// InventoryNode represents a generic node in the vCenter inventory tree.
type InventoryNode struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Type          string          `json:"type"`
	Children      []InventoryNode `json:"children,omitempty"`
	Networks      []VMNetwork     `json:"networks,omitempty"`
	Disks         []VMDisk        `json:"disks,omitempty"`
	CPU           int32           `json:"cpu,omitempty"`
	MemoryMB      int32           `json:"memoryMB,omitempty"`
	DiskSizeGB    int64           `json:"diskSizeGB,omitempty"`
	Folder        string          `json:"folder,omitempty"`
	PowerState    string          `json:"powerState,omitempty"`
	DatastoreID   string          `json:"datastoreId,omitempty"`
	DatastoreName string          `json:"datastoreName,omitempty"`
}

// GetVCenterInventory connects to vCenter and returns the inventory tree.
func GetVCenterInventory(ctx context.Context, creds VCenterCredentials) (*InventoryNode, error) {
	fullURL := creds.URL
	if !strings.HasPrefix(fullURL, "https://") && !strings.HasPrefix(fullURL, "http://") {
		fullURL = "https://" + fullURL
	}

	u, err := url.Parse(fullURL)
	if err != nil {
		return nil, err
	}
	u.User = url.UserPassword(creds.Username, creds.Password)

	log.Infof("Connecting to vCenter at %s", creds.URL)
	c, err := govmomi.NewClient(ctx, u, true)
	if err != nil {
		return nil, err
	}
	defer c.Logout(ctx)

	finder := find.NewFinder(c.Client, true)
	dc, err := finder.Datacenter(ctx, creds.Datacenter)
	if err != nil {
		return nil, err
	}
	finder.SetDatacenter(dc)

	rootNode := &InventoryNode{
		Name: dc.Name(),
		Type: "datacenter",
	}

	folders, err := dc.Folders(ctx)
	if err != nil {
		return nil, err
	}

	rootFolder := object.NewFolder(c.Client, folders.VmFolder.Reference())
	children, err := rootFolder.Children(ctx)
	if err != nil {
		return nil, err
	}

	for _, child := range children {
		// Initialize recursion with an empty string
		node, err := processEntity(ctx, c, child, "")
		if err != nil {
			log.Warnf("Could not process entity %s: %v", child.Reference().Value, err)
			continue
		}
		if node != nil {
			rootNode.Children = append(rootNode.Children, *node)
		}
	}

	log.Debugf("Constructed vCenter inventory tree: %+v", rootNode)
	return rootNode, nil
}

// processEntity recursively processes vCenter inventory objects.
func processEntity(ctx context.Context, c *govmomi.Client, entity object.Reference, folderPath string) (*InventoryNode, error) {
	ref := entity.Reference()

	var me mo.ManagedEntity
	pc := property.DefaultCollector(c.Client)
	if err := pc.RetrieveOne(ctx, ref, []string{"name"}, &me); err != nil {
		return nil, err
	}

	node := &InventoryNode{
		ID:   ref.Value,
		Name: me.Name,
		Type: ref.Type,
	}

	switch e := entity.(type) {
	case *object.VirtualMachine:
		var mvm mo.VirtualMachine
		err := pc.RetrieveOne(ctx, ref, []string{"guest", "summary", "config", "network", "config.hardware.device", "runtime", "datastore"}, &mvm)
		if err != nil {
			return nil, err
		}

		log.Debugf("Raw VM data from vCenter for %s: %+v", me.Name, mvm)

		var vmNetworks []VMNetwork
		var vmDisks []VMDisk

		if mvm.Config != nil {
			// Get the list of virtual devices from the managed object
			deviceList := object.VirtualDeviceList(mvm.Config.Hardware.Device)

			// Map to find controller types
			controllers := make(map[int32]string)
			for _, device := range deviceList {
				d := device.GetVirtualDevice()
				switch device.(type) {
				case *types.VirtualLsiLogicController, *types.VirtualLsiLogicSASController, *types.VirtualBusLogicController, *types.ParaVirtualSCSIController:
					controllers[d.Key] = "scsi"
				case *types.VirtualIDEController:
					controllers[d.Key] = "ide"
				case *types.VirtualSATAController:
					controllers[d.Key] = "sata"
				case *types.VirtualNVMEController:
					controllers[d.Key] = "nvme"
				}
			}

			// Find all network card devices and disks
			for _, device := range deviceList {
				// Use a type assertion to see if the device is a network card
				if card, ok := device.(types.BaseVirtualEthernetCard); ok {
					// Get the backing info from the network card
					backing := card.GetVirtualEthernetCard().Backing

					netName := "unknown"
					netID := ""
					switch backingInfo := backing.(type) {
					case *types.VirtualEthernetCardNetworkBackingInfo:
						netName = backingInfo.DeviceName
						if backingInfo.Network != nil {
							netID = backingInfo.Network.Value
						}
					case *types.VirtualEthernetCardDistributedVirtualPortBackingInfo:
						netName = backingInfo.Port.PortgroupKey
						netID = backingInfo.Port.PortgroupKey
					}

					vmNetworks = append(vmNetworks, VMNetwork{
						Name: netName,
						ID:   netID,
						MAC:  card.GetVirtualEthernetCard().MacAddress,
						Key:  card.GetVirtualEthernetCard().Key,
					})
				} else if disk, ok := device.(*types.VirtualDisk); ok {
					busType := "unknown"
					if t, ok := controllers[disk.ControllerKey]; ok {
						busType = t
					}
					name := "Disk"
					if disk.DeviceInfo != nil {
						name = disk.DeviceInfo.GetDescription().Label
					}
					vmDisks = append(vmDisks, VMDisk{
						Name:     name,
						Capacity: disk.CapacityInBytes,
						BusType:  busType,
						UnitNum:  *disk.UnitNumber,
					})
				}
			}
		} else {
			log.Warnf("VM '%s' has nil Config, skipping device processing", me.Name)
		}

		log.Debugf("Successfully found networks for VM '%s': %v\n", me.Name, vmNetworks)

		node.Networks = vmNetworks
		node.Disks = vmDisks
		node.DiskSizeGB = mvm.Summary.Storage.Committed / (1024 * 1024 * 1024)

		node.CPU = mvm.Summary.Config.NumCpu
		node.MemoryMB = mvm.Summary.Config.MemorySizeMB

		node.PowerState = string(mvm.Runtime.PowerState)
		node.Folder = folderPath // Store the accumulated folder path

		// Auto-detect datastore ID from the VM's datastore references
		if len(mvm.Datastore) > 0 {
			node.DatastoreID = mvm.Datastore[0].Value
			// Try to get the datastore name
			var dsmo mo.Datastore
			if dsErr := pc.RetrieveOne(ctx, mvm.Datastore[0], []string{"name"}, &dsmo); dsErr == nil {
				node.DatastoreName = dsmo.Name
			}
		}

		return node, nil

	case *object.Folder:
		// Build the path: parent/current
		childPath := folderPath
		if childPath != "" {
			childPath += "/"
		}
		childPath += me.Name

		children, err := e.Children(ctx)
		if err != nil {
			return nil, err
		}
		for _, child := range children {
			childNode, err := processEntity(ctx, c, child, childPath)
			if err != nil {
				log.Warnf("Could not process child entity %s: %v", child.Reference().Value, err)
				continue
			}
			if childNode != nil {
				node.Children = append(node.Children, *childNode)
			}
		}
		return node, nil

	case *object.ClusterComputeResource:
		rp, err := e.ResourcePool(ctx)
		if err != nil {
			return node, nil
		}
		var mrp mo.ResourcePool
		err = pc.RetrieveOne(ctx, rp.Reference(), []string{"vm"}, &mrp)
		if err != nil {
			return nil, err
		}
		for _, vmRef := range mrp.Vm {
			// Pass the existing folderPath through clusters
			childNode, err := processEntity(ctx, c, object.NewVirtualMachine(c.Client, vmRef), folderPath)
			if err != nil {
				log.Warnf("Could not process child vm in cluster %s: %v", vmRef.Value, err)
				continue
			}
			if childNode != nil {
				node.Children = append(node.Children, *childNode)
			}
		}
		return node, nil

	default:
		return nil, nil
	}
}

// PowerOpVM performs a power operation on a VM.
func PowerOpVM(ctx context.Context, creds VCenterCredentials, vmName string, op string) error {
	fullURL := creds.URL
	if !strings.HasPrefix(fullURL, "https://") && !strings.HasPrefix(fullURL, "http://") {
		fullURL = "https://" + fullURL
	}
	u, err := url.Parse(fullURL)
	if err != nil {
		return err
	}
	u.User = url.UserPassword(creds.Username, creds.Password)

	c, err := govmomi.NewClient(ctx, u, true)
	if err != nil {
		return err
	}
	defer c.Logout(ctx)

	finder := find.NewFinder(c.Client, true)
	dc, err := finder.Datacenter(ctx, creds.Datacenter)
	if err != nil {
		return err
	}
	finder.SetDatacenter(dc)

	vm, err := finder.VirtualMachine(ctx, vmName)
	if err != nil {
		return err
	}

	var task *object.Task
	switch op {
	case "on":
		task, err = vm.PowerOn(ctx)
	case "off":
		task, err = vm.PowerOff(ctx)
	case "reset":
		task, err = vm.Reset(ctx)
	case "shutdown":
		err = vm.ShutdownGuest(ctx)
		if err != nil {
			// Fallback to power off if shutdown fails (e.g. tools not installed)
			log.Warnf("Guest shutdown failed for %s, falling back to power off: %v", vmName, err)
			task, err = vm.PowerOff(ctx)
		} else {
			return nil // ShutdownGuest doesn't return a task, it's just an error if it fails to initiate
		}
	default:
		return fmt.Errorf("unsupported power operation: %s", op)
	}

	if err != nil {
		return err
	}

	if task != nil {
		return task.Wait(ctx)
	}
	return nil
}

// RenameVM renames a VM in vCenter.
func RenameVM(ctx context.Context, creds VCenterCredentials, oldName string, newName string) error {
	fullURL := creds.URL
	if !strings.HasPrefix(fullURL, "https://") && !strings.HasPrefix(fullURL, "http://") {
		fullURL = "https://" + fullURL
	}
	u, err := url.Parse(fullURL)
	if err != nil {
		return err
	}
	u.User = url.UserPassword(creds.Username, creds.Password)

	c, err := govmomi.NewClient(ctx, u, true)
	if err != nil {
		return err
	}
	defer c.Logout(ctx)

	finder := find.NewFinder(c.Client, true)
	dc, err := finder.Datacenter(ctx, creds.Datacenter)
	if err != nil {
		return err
	}
	finder.SetDatacenter(dc)

	vm, err := finder.VirtualMachine(ctx, oldName)
	if err != nil {
		return err
	}

	task, err := vm.Rename(ctx, newName)
	if err != nil {
		return err
	}

	return task.Wait(ctx)
}

// UpdateVMNetworkMAC updates the MAC address of a specific network device.
func UpdateVMNetworkMAC(ctx context.Context, creds VCenterCredentials, vmName string, deviceKey int32, newMAC string) error {
	fullURL := creds.URL
	if !strings.HasPrefix(fullURL, "https://") && !strings.HasPrefix(fullURL, "http://") {
		fullURL = "https://" + fullURL
	}
	u, err := url.Parse(fullURL)
	if err != nil {
		return err
	}
	u.User = url.UserPassword(creds.Username, creds.Password)

	c, err := govmomi.NewClient(ctx, u, true)
	if err != nil {
		return err
	}
	defer c.Logout(ctx)

	finder := find.NewFinder(c.Client, true)
	dc, err := finder.Datacenter(ctx, creds.Datacenter)
	if err != nil {
		return err
	}
	finder.SetDatacenter(dc)

	vm, err := finder.VirtualMachine(ctx, vmName)
	if err != nil {
		return err
	}

	var mvm mo.VirtualMachine
	pc := property.DefaultCollector(c.Client)
	if err := pc.RetrieveOne(ctx, vm.Reference(), []string{"config.hardware.device"}, &mvm); err != nil {
		return err
	}

	deviceList := object.VirtualDeviceList(mvm.Config.Hardware.Device)
	device := deviceList.FindByKey(deviceKey)
	if device == nil {
		return fmt.Errorf("device with key %d not found", deviceKey)
	}

	nic, ok := device.(types.BaseVirtualEthernetCard)
	if !ok {
		return fmt.Errorf("device with key %d is not a network card", deviceKey)
	}

	card := nic.GetVirtualEthernetCard()
	card.MacAddress = newMAC
	card.AddressType = "manual"

	spec := types.VirtualMachineConfigSpec{
		DeviceChange: []types.BaseVirtualDeviceConfigSpec{
			&types.VirtualDeviceConfigSpec{
				Operation: types.VirtualDeviceConfigSpecOperationEdit,
				Device:    device,
			},
		},
	}

	task, err := vm.Reconfigure(ctx, spec)
	if err != nil {
		return err
	}

	return task.Wait(ctx)
}

// GetVCenterInventoryAutoDiscover connects to vCenter and auto-discovers the first datacenter.
// This is used by Forklift, which doesn't store the datacenter name in the Provider spec.
func GetVCenterInventoryAutoDiscover(ctx context.Context, creds VCenterCredentials) (*InventoryNode, error) {
	fullURL := creds.URL
	if !strings.HasPrefix(fullURL, "https://") && !strings.HasPrefix(fullURL, "http://") {
		fullURL = "https://" + fullURL
	}

	u, err := url.Parse(fullURL)
	if err != nil {
		return nil, err
	}
	u.User = url.UserPassword(creds.Username, creds.Password)

	log.Infof("Connecting to vCenter at %s (auto-discover mode)", creds.URL)
	c, err := govmomi.NewClient(ctx, u, true)
	if err != nil {
		return nil, err
	}
	defer c.Logout(ctx)

	finder := find.NewFinder(c.Client, true)

	// If datacenter is specified, use it; otherwise auto-discover
	var dc *object.Datacenter
	if creds.Datacenter != "" {
		dc, err = finder.Datacenter(ctx, creds.Datacenter)
		if err != nil {
			return nil, fmt.Errorf("failed to find datacenter %s: %w", creds.Datacenter, err)
		}
	} else {
		// Auto-discover: get the default datacenter
		dc, err = finder.DefaultDatacenter(ctx)
		if err != nil {
			// Try listing all datacenters
			dcs, listErr := finder.DatacenterList(ctx, "*")
			if listErr != nil || len(dcs) == 0 {
				return nil, fmt.Errorf("no datacenter found: %v", err)
			}
			dc = dcs[0]
		}
	}

	finder.SetDatacenter(dc)

	rootNode := &InventoryNode{
		Name: dc.Name(),
		Type: "datacenter",
	}

	folders, err := dc.Folders(ctx)
	if err != nil {
		return nil, err
	}

	rootFolder := object.NewFolder(c.Client, folders.VmFolder.Reference())
	children, err := rootFolder.Children(ctx)
	if err != nil {
		return nil, err
	}

	for _, child := range children {
		node, err := processEntity(ctx, c, child, "")
		if err != nil {
			log.Warnf("Could not process entity %s: %v", child.Reference().Value, err)
			continue
		}
		if node != nil {
			rootNode.Children = append(rootNode.Children, *node)
		}
	}

	log.Debugf("Constructed vCenter inventory tree (auto-discover): %+v", rootNode)
	return rootNode, nil
}
