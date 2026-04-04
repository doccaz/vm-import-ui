// pkg/types.go
package main

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// The JSON tags MUST match the actual CRD field names from the Harvester documentation.
type VirtualMachineImportSpec struct {
	VirtualMachineName string           `json:"virtualMachineName"`
	SourceCluster      SourceCluster    `json:"sourceCluster"`
	NetworkMapping     []NetworkMapping `json:"networkMapping,omitempty"`
	StorageClass       string           `json:"storageClass,omitempty"`
	Schedule           *metav1.Time     `json:"schedule,omitempty"`

	// New fields for folder support and advanced options
	Folder                         string `json:"folder,omitempty"`
	ForcePowerOff                  *bool  `json:"forcePowerOff,omitempty"`
	GracefulShutdownTimeoutSeconds int    `json:"gracefulShutdownTimeoutSeconds,omitempty"`
	DefaultNetworkInterfaceModel   string `json:"defaultNetworkInterfaceModel,omitempty"`

	// New fields for Harvester v1.6+
	SkipPreflightChecks *bool  `json:"skipPreflightChecks,omitempty"`
	DefaultDiskBusType  string `json:"defaultDiskBusType,omitempty"`
}

type SourceCluster struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
}

type NetworkMapping struct {
	SourceNetwork      string `json:"sourceNetwork"`
	DestinationNetwork string `json:"destinationNetwork"`
	// New field for per-interface model selection
	NetworkInterfaceModel string `json:"networkInterfaceModel,omitempty"`
}

// VirtualMachineImportStatus defines the observed state of VirtualMachineImport
type VirtualMachineImportStatus struct {
	Conditions   []metav1.Condition `json:"conditions,omitempty"`
	ImportStatus string             `json:"importStatus,omitempty"`
}

// VirtualMachineImport is the Schema for the virtualmachineimports API
type VirtualMachineImport struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   VirtualMachineImportSpec   `json:"spec,omitempty"`
	Status VirtualMachineImportStatus `json:"status,omitempty"`
}

// --- Forklift Types ---

// CreateForkliftProviderPayload is the JSON payload from the frontend to create a Forklift Provider + Secret
type CreateForkliftProviderPayload struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	URL          string `json:"url"`                    // vSphere URL or NFS path (for OVA: host:/nfs-path)
	Username     string `json:"username"`
	Password     string `json:"password"`
	SdkEndpoint  string `json:"sdkEndpoint,omitempty"`  // "vcenter" (default) or "esxi" for standalone ESXi hosts
	ProviderType string `json:"providerType,omitempty"` // "vsphere" (default) or "ova"
}

// ForkliftNetworkMapEntry represents a single network mapping for Forklift
type ForkliftNetworkMapEntry struct {
	SourceID        string `json:"sourceId"`        // vSphere network moRef, e.g. network-1008
	SourceName      string `json:"sourceName,omitempty"` // vSphere network display name for fallback matching
	DestinationType string `json:"destinationType"` // "pod" or "multus"
	DestinationName string `json:"destinationName,omitempty"` // multus network name if type is multus
	DestinationNamespace string `json:"destinationNamespace,omitempty"`
}

// ForkliftStorageMapEntry represents a single storage mapping for Forklift
type ForkliftStorageMapEntry struct {
	SourceID                string `json:"sourceId"`                // vSphere datastore moRef, e.g. datastore-1007
	SourceName              string `json:"sourceName,omitempty"`    // OVA disk filename (used instead of sourceId for OVA providers)
	DestinationStorageClass string `json:"destinationStorageClass"` // Harvester storage class name
	VolumeMode              string `json:"volumeMode,omitempty"`    // "Block" or "Filesystem"
	AccessMode              string `json:"accessMode,omitempty"`    // "ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany"
}

// ForkliftVMEntry represents a VM to migrate in a Forklift Plan
type ForkliftVMEntry struct {
	ID         string `json:"id"`                   // vSphere VM moRef, e.g. vm-1019
	Name       string `json:"name"`                 // VM display name
	TargetName string `json:"targetName,omitempty"` // RFC-1123 compliant name for the destination VM in Kubernetes
}

// CreateForkliftPlanPayload is the JSON payload from the frontend to create a Forklift migration plan
// (which creates NetworkMap + StorageMap + Plan atomically)
type CreateForkliftPlanPayload struct {
	Name                  string                    `json:"name"`
	Namespace             string                    `json:"namespace"`
	ProviderName          string                    `json:"providerName"`
	ProviderNamespace     string                    `json:"providerNamespace"`
	ProviderType          string                    `json:"providerType,omitempty"`          // "vsphere" (default) or "ova"
	HostProviderNamespace string                    `json:"hostProviderNamespace,omitempty"` // Namespace where Forklift's "host" provider lives (defaults to "forklift")
	TargetNamespace       string                    `json:"targetNamespace"`
	NetworkMappings   []ForkliftNetworkMapEntry `json:"networkMappings"`
	StorageMappings   []ForkliftStorageMapEntry `json:"storageMappings"`
	VMs               []ForkliftVMEntry         `json:"vms"`
	// Advanced options
	MigrateSharedDisks bool `json:"migrateSharedDisks"`
	PopulatorLabels    bool `json:"populatorLabels"`
	Warm               bool `json:"warm,omitempty"`
	// Source VM metadata for annotations (same pattern as VMIC)
	SourceVmCpu        int32  `json:"sourceVmCpu,omitempty"`
	SourceVmMemoryMB   int32  `json:"sourceVmMemoryMB,omitempty"`
	SourceVmDiskSizeGB int64  `json:"sourceVmDiskSizeGB,omitempty"`
	SourceVmDisks                string `json:"sourceVmDisks,omitempty"`                // JSON string of disk array
	SourceVmNetworks             string `json:"sourceVmNetworks,omitempty"`             // JSON string of network array
	DefaultNetworkInterfaceModel string `json:"defaultNetworkInterfaceModel,omitempty"` // e.g. virtio, e1000, e1000e
}
