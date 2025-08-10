package main

var mockVcenterInventory = map[string]interface{}{
	"name": "Datacenter-Main", "type": "datacenter", "children": []map[string]interface{}{
		{"name": "Cluster-Production", "type": "cluster", "children": []map[string]interface{}{
			{"name": "Web Servers", "type": "folder", "children": []map[string]interface{}{
				{"name": "web-vm-01", "type": "vm", "networks": []string{"VM Network"}, "disks": 2, "diskSizeGB": 50},
				{"name": "web-vm-02", "type": "vm", "networks": []string{"VM Network", "VLAN-101"}, "disks": 1, "diskSizeGB": 40},
			}},
			{"name": "db-vm-prod-01", "type": "vm", "networks": []string{"DB-Network-Private"}, "disks": 3, "diskSizeGB": 200},
		}},
	},
}

var mockHarvesterNetworks = []map[string]interface{}{
	{"metadata": map[string]interface{}{"name": "vlan-100-prod"}},
	{"metadata": map[string]interface{}{"name": "vlan-250-dmz"}},
	{"metadata": map[string]interface{}{"name": "storage-backend-net"}},
}

var mockPlans = []map[string]interface{}{
	{"id": "plan-1", "name": "Migrate Prod Web Servers", "status": "Completed", "vms": 2, "target": "default", "totalSizeGB": 90},
	{"id": "plan-2", "name": "Import DBs", "status": "In Progress", "vms": 1, "target": "default", "totalSizeGB": 200},
}

var mockPlanDetails = map[string]interface{}{
	"id":     "plan-2",
	"name":   "Import DBs",
	"status": "In Progress",
	"vms": []map[string]interface{}{
		{"name": "db-vm-prod-01", "status": "Queued", "progress": 0, "diskSizeGB": 200},
	},
}
