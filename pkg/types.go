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
	ForcePowerOff                  bool   `json:"forcePowerOff,omitempty"`
	GracefulShutdownTimeoutSeconds int    `json:"gracefulShutdownTimeoutSeconds,omitempty"`
	DefaultNetworkInterfaceModel   string `json:"defaultNetworkInterfaceModel,omitempty"`
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
