// pkg/export_job.go
//
// Builds the Kubernetes Job that performs one export.
//
// The Job IS the export's state record: it lives in the source VM's namespace,
// carries the export metadata in labels and annotations, and is what the API
// lists. That avoids a ConfigMap store (which would need write RBAC and its own
// garbage collection) and survives an API-pod restart or replicaCount > 1.
package main

import (
	"encoding/json"
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	exportLabelManagedBy = "app.kubernetes.io/managed-by"
	exportLabelMarker    = "vm-import-ui.harvesterhci.io/export"
	exportLabelVM        = "vm-import-ui.harvesterhci.io/vm"
	exportLabelID        = "vm-import-ui.harvesterhci.io/export-id"

	exportAnnProfile    = "vm-import-ui.harvesterhci.io/profile"
	exportAnnTargetName = "vm-import-ui.harvesterhci.io/target-name"
	exportAnnVMName     = "vm-import-ui.harvesterhci.io/vm-name"

	exportManagedByValue = "vm-import-ui"

	// exportMountPath is where the shared export volume appears in the Job.
	exportMountPath = "/export"
)

// ExportJobOptions carries the cluster-side knobs the worker itself never sees.
type ExportJobOptions struct {
	Namespace     string
	Image         string
	ExportPVC     string // RWX claim holding staged output and the finished OVA
	SourceClaims  []string
	TTLSeconds    int32
	DeadlineSecs  int64
	LogLevel      string
	RunAsUser     *int64
	FSGroup       *int64
	JobResources  corev1.ResourceRequirements
	ExportRootEnv string
}

// exportJobName is the Job (and thus the export's) stable identifier.
func exportJobName(exportID string) string { return "vm-export-" + exportID }

// buildExportJob renders the Job for one export.
//
// The source PVCs are attached as raw block devices via volumeDevices and marked
// readOnly. Reading them is only safe because the VM is verified stopped first:
// these are ReadWriteMany block volumes, so nothing in Kubernetes would prevent
// us attaching one that is still in use, and doing so yields a torn image.
func buildExportJob(spec ExportSpec, opts ExportJobOptions) (*batchv1.Job, error) {
	if len(spec.Disks) != len(opts.SourceClaims) {
		return nil, fmt.Errorf("internal error: %d disks but %d source claims", len(spec.Disks), len(opts.SourceClaims))
	}
	if opts.ExportPVC == "" {
		return nil, fmt.Errorf("no export storage configured; set export.storage in the chart values")
	}

	specJSON, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("marshalling export spec: %w", err)
	}

	var devices []corev1.VolumeDevice
	var volumes []corev1.Volume
	for i, claim := range opts.SourceClaims {
		name := fmt.Sprintf("srcdisk%d", i)
		devices = append(devices, corev1.VolumeDevice{
			Name:       name,
			DevicePath: spec.Disks[i].DevicePath,
		})
		volumes = append(volumes, corev1.Volume{
			Name: name,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
					ClaimName: claim,
					ReadOnly:  true,
				},
			},
		})
	}
	volumes = append(volumes, corev1.Volume{
		Name: "export",
		VolumeSource: corev1.VolumeSource{
			PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
				ClaimName: opts.ExportPVC,
			},
		},
	})

	root := opts.ExportRootEnv
	if root == "" {
		root = exportMountPath
	}
	logLevel := opts.LogLevel
	if logLevel == "" {
		logLevel = "info"
	}

	// Never retried: a retry re-reads and re-converts every byte, which on a
	// multi-hundred-gigabyte disk is far worse than surfacing the failure.
	backoff := int32(0)
	ttl := opts.TTLSeconds
	if ttl == 0 {
		ttl = 3600
	}
	deadline := opts.DeadlineSecs
	if deadline == 0 {
		deadline = 6 * 60 * 60
	}
	automount := false

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      exportJobName(spec.ExportID),
			Namespace: opts.Namespace,
			Labels: map[string]string{
				exportLabelManagedBy: exportManagedByValue,
				exportLabelMarker:    "true",
				exportLabelVM:        spec.VMName,
				exportLabelID:        spec.ExportID,
			},
			Annotations: map[string]string{
				exportAnnProfile:    spec.Profile,
				exportAnnTargetName: spec.TargetName,
				exportAnnVMName:     spec.VMName,
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			ActiveDeadlineSeconds:   &deadline,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						exportLabelManagedBy: exportManagedByValue,
						exportLabelMarker:    "true",
						exportLabelID:        spec.ExportID,
					},
				},
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					// The worker needs no API access: its whole instruction set
					// arrives via EXPORT_SPEC and the mounted volumes.
					AutomountServiceAccountToken: &automount,
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser: opts.RunAsUser,
						FSGroup:   opts.FSGroup,
					},
					Volumes: volumes,
					Containers: []corev1.Container{{
						Name:    "export",
						Image:   opts.Image,
						Command: []string{"/usr/local/bin/vm-import-ui", "export-worker"},
						Env: []corev1.EnvVar{
							{Name: "EXPORT_ROOT", Value: root},
							{Name: "EXPORT_SPEC", Value: string(specJSON)},
							{Name: "LOG_LEVEL", Value: logLevel},
						},
						VolumeDevices: devices,
						VolumeMounts: []corev1.VolumeMount{{
							Name:      "export",
							MountPath: root,
						}},
						Resources: opts.JobResources,
					}},
				},
			},
		},
	}
	return job, nil
}
