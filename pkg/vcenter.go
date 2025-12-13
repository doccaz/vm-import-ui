// pkg/vcenter.go
package main

import (
	"context"
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

// InventoryNode represents a generic node in the vCenter inventory tree.
type InventoryNode struct {
	Name       string          `json:"name"`
	Type       string          `json:"type"`
	Children   []InventoryNode `json:"children,omitempty"`
	Networks   []string        `json:"networks,omitempty"`
	CPU        int32           `json:"cpu,omitempty"`
	MemoryMB   int32           `json:"memoryMB,omitempty"`
	DiskSizeGB int64           `json:"diskSizeGB,omitempty"`
	Folder     string          `json:"folder,omitempty"`
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
	dc, err := finder.DefaultDatacenter(ctx)
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
		// Initialize recursion with an empty folder path
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
		Name: me.Name,
		Type: ref.Type,
	}

	switch e := entity.(type) {
	case *object.VirtualMachine:
		var mvm mo.VirtualMachine
		err := pc.RetrieveOne(ctx, ref, []string{"guest", "summary", "config", "network", "config.hardware.device"}, &mvm)
		if err != nil {
			return nil, err
		}

		log.Debugf("Raw VM data from vCenter for %s: %+v", me.Name, mvm)

		var networkNames []string

		// Get the list of virtual devices from the managed object
		deviceList := object.VirtualDeviceList(mvm.Config.Hardware.Device)

		// Find all network card devices
		for _, device := range deviceList {
			// Use a type assertion to see if the device is a network card
			if card, ok := device.(types.BaseVirtualEthernetCard); ok {
				// Get the backing info from the network card
				backing := card.GetVirtualEthernetCard().Backing

				switch backingInfo := backing.(type) {
				case *types.VirtualEthernetCardNetworkBackingInfo:
					// This handles standard vSwitch networks
					networkNames = append(networkNames, backingInfo.DeviceName)
				case *types.VirtualEthernetCardDistributedVirtualPortBackingInfo:
					// This handles distributed vSwitch networks
					networkNames = append(networkNames, backingInfo.Port.PortgroupKey)
				}
			}
		}

		log.Debugf("Successfully found networks for VM '%s': %v\n", me.Name, networkNames)

		node.Networks = networkNames
		node.DiskSizeGB = mvm.Summary.Storage.Committed / (1024 * 1024 * 1024)
		node.CPU = mvm.Summary.Config.NumCpu
		node.MemoryMB = mvm.Summary.Config.MemorySizeMB
		node.Folder = folderPath // Store the accumulated folder path
		return node, nil

	case *object.Folder:
		// Build the path: parent/current
		childPath := me.Name
		if folderPath != "" {
			childPath = folderPath + "/" + me.Name
		}

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
