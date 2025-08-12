// pkg/mock_data.go
package main

var mockVcenterInventory = map[string]interface{}{
	"name": "Mock-Datacenter", "type": "datacenter", "children": []map[string]interface{}{
		{"name": "Mock-Cluster", "type": "cluster", "children": []map[string]interface{}{
			{"name": "Mock-VM-01", "type": "VirtualMachine", "networks": []string{"Mock-Network"}, "disks": 1, "diskSizeGB": 50, "cpu": 2, "memoryMB": 4096},
			{"name": "Mock-VM-02", "type": "VirtualMachine", "networks": []string{"Mock-Network"}, "disks": 2, "diskSizeGB": 100, "cpu": 4, "memoryMB": 8192},
		}},
	},
}

var mockHarvesterNetworks = []map[string]interface{}{
	{"metadata": map[string]interface{}{"name": "vlan-100-prod"}},
	{"metadata": map[string]interface{}{"name": "vlan-250-dmz"}},
}

var mockPlans = []map[string]interface{}{
	{"id": "plan-1", "name": "Migrate Prod Web Servers", "status": "Completed", "vms": 2, "target": "default", "totalSizeGB": 90},
	{"id": "plan-2", "name": "Import DBs", "status": "In Progress", "vms": 1, "target": "default", "totalSizeGB": 200},
}

var mockPlanDetails = map[string]interface{}{
	"id": "plan-2", "name": "Import DBs", "status": "In Progress",
	"vms": []map[string]interface{}{
		{"name": "db-vm-prod-01", "status": "Queued", "progress": 0, "diskSizeGB": 200},
	},
}

var mockNamespaces = []map[string]interface{}{
	{"metadata": map[string]interface{}{"name": "default"}},
	{"metadata": map[string]interface{}{"name": "kube-system"}},
}
