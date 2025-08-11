// pkg/vcenter.go
package main

import (
	"context"
	"net/url"

	log "github.com/sirupsen/logrus"
	"github.com/vmware/govmomi"
	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/property"
	"github.com/vmware/govmomi/vim25/mo"
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
}

// GetVCenterInventory connects to vCenter and returns the inventory tree.
func GetVCenterInventory(ctx context.Context, creds VCenterCredentials) (*InventoryNode, error) {
	u, err := url.Parse(creds.URL)
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
		node, err := processEntity(ctx, c, child)
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
func processEntity(ctx context.Context, c *govmomi.Client, entity object.Reference) (*InventoryNode, error) {
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
		err := pc.RetrieveOne(ctx, ref, []string{"network", "summary.storage", "summary.config"}, &mvm)
		if err != nil {
			return nil, err
		}

		if mvm.Network != nil {
			var nets []mo.Network
			err = pc.Retrieve(ctx, mvm.Network, []string{"name"}, &nets)
			if err != nil {
				return nil, err
			}
			for _, net := range nets {
				node.Networks = append(node.Networks, net.Name)
			}
		}

		node.DiskSizeGB = mvm.Summary.Storage.Committed / (1024 * 1024 * 1024)
		node.CPU = mvm.Summary.Config.NumCpu
		node.MemoryMB = mvm.Summary.Config.MemorySizeMB
		return node, nil

	case *object.Folder:
		children, err := e.Children(ctx)
		if err != nil {
			return nil, err
		}
		for _, child := range children {
			childNode, err := processEntity(ctx, c, child)
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
			childNode, err := processEntity(ctx, c, object.NewVirtualMachine(c.Client, vmRef))
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
