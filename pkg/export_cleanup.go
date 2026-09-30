// pkg/export_cleanup.go
//
// Removing an export's files from its export volume.
//
// An export's OVA and its .vm-import-ui/<id>/ status folder live on the export
// PVC of the VM's namespace. The API pod mounts only ITS OWN namespace's export
// volume (EXPORT_ROOT), so for an export in any other namespace it cannot touch
// the files at all. Those are removed by a short-lived cleanup Job that runs in
// the export's namespace, mounts that namespace's export PVC and runs
// `vm-import-ui export-cleanup` — the same binary, the same path checks.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	log "github.com/sirupsen/logrus"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	// exportLabelCleanup marks a cleanup Job. It must NOT carry exportLabelMarker:
	// that label is how the API enumerates exports, and a cleanup Job is not one.
	exportLabelCleanup = "vm-import-ui.harvesterhci.io/export-cleanup"

	// exportCleanupActiveDelay gives a still-running export's pod time to stop
	// after its Job is deleted, so the worker cannot recreate what we just removed.
	exportCleanupActiveDelay = 30
)

// exportIDPattern matches what newExportID produces (hex, or decimal in its
// fallback). Anything else is refused: an empty ID would make the status-folder
// path resolve to .vm-import-ui itself and wipe every export's state.
var exportIDPattern = regexp.MustCompile(`^[0-9a-f]{1,32}$`)

func exportCleanupJobName(exportID string) string { return "vm-export-cleanup-" + exportID }

// removeExportFiles deletes one export's OVA and status folder (which also holds
// any staging data) from the volume mounted at root. Missing files are fine, so
// it is safe to repeat. target is the OVA name without ".ova"; empty skips it.
func removeExportFiles(root, exportID, target string) error {
	if !exportIDPattern.MatchString(exportID) {
		return fmt.Errorf("refusing to clean up: %q is not a valid export id", exportID)
	}
	statusDir, err := safeExportPath(root, filepath.Join(".vm-import-ui", exportID))
	if err != nil {
		return err
	}
	var ovaPath string
	if target != "" {
		ovaPath, err = safeExportPath(root, target+".ova")
		if err != nil {
			return err
		}
	}

	var firstErr error
	if ovaPath != "" {
		if err := os.Remove(ovaPath); err != nil && !os.IsNotExist(err) {
			firstErr = fmt.Errorf("removing %s: %w", ovaPath, err)
		}
	}
	if err := os.RemoveAll(statusDir); err != nil && firstErr == nil {
		firstErr = fmt.Errorf("removing %s: %w", statusDir, err)
	}
	return firstErr
}

// RunExportCleanup is the `export-cleanup` mode of the binary, run inside the
// cleanup Job. Returns the process exit code.
func RunExportCleanup() int {
	root := os.Getenv("EXPORT_ROOT")
	id := os.Getenv("EXPORT_ID")
	target := os.Getenv("EXPORT_TARGET")
	if d, err := strconv.Atoi(os.Getenv("EXPORT_CLEANUP_DELAY_SECONDS")); err == nil && d > 0 {
		time.Sleep(time.Duration(d) * time.Second)
	}
	if err := removeExportFiles(root, id, target); err != nil {
		log.Errorf("Export cleanup failed: %v", err)
		return 1
	}
	log.Infof("Removed export %s (%s.ova) from %s", id, target, root)
	return 0
}

// ExportCleanupJobOptions describes one cleanup Job.
type ExportCleanupJobOptions struct {
	Namespace     string // the export's namespace, where its export PVC lives
	Image         string
	ExportPVC     string
	ExportID      string
	TargetName    string
	DelaySeconds  int
	RunAsUser     *int64
	FSGroup       *int64
	ExportRootEnv string
}

// buildExportCleanupJob renders the Job that removes one export's files from the
// export volume of opts.Namespace.
func buildExportCleanupJob(opts ExportCleanupJobOptions) (*batchv1.Job, error) {
	if opts.ExportPVC == "" {
		return nil, fmt.Errorf("no export storage configured; set export.storage in the chart values")
	}
	if !exportIDPattern.MatchString(opts.ExportID) {
		return nil, fmt.Errorf("%q is not a valid export id", opts.ExportID)
	}
	root := opts.ExportRootEnv
	if root == "" {
		root = exportMountPath
	}
	// Validate the target now so an unsafe name fails the request, not the Job.
	if opts.TargetName != "" {
		if _, err := safeExportPath(root, opts.TargetName+".ova"); err != nil {
			return nil, err
		}
	}

	// Idempotent, so a couple of retries are harmless. Self-tidying: it is not
	// a record of anything, so unlike the export Job it may expire.
	backoff, ttl, deadline := int32(2), int32(3600), int64(600)
	automount := false
	labels := map[string]string{
		exportLabelManagedBy: exportManagedByValue,
		exportLabelCleanup:   opts.ExportID,
	}

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      exportCleanupJobName(opts.ExportID),
			Namespace: opts.Namespace,
			Labels:    labels,
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			ActiveDeadlineSeconds:   &deadline,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					RestartPolicy:                corev1.RestartPolicyNever,
					AutomountServiceAccountToken: &automount,
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser: opts.RunAsUser,
						FSGroup:   opts.FSGroup,
					},
					Volumes: []corev1.Volume{{
						Name: "export",
						VolumeSource: corev1.VolumeSource{
							PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: opts.ExportPVC},
						},
					}},
					Containers: []corev1.Container{{
						Name:    "cleanup",
						Image:   opts.Image,
						Command: []string{"/usr/local/bin/vm-import-ui", "export-cleanup"},
						// Passed as env, never interpolated into a shell command.
						Env: []corev1.EnvVar{
							{Name: "EXPORT_ROOT", Value: root},
							{Name: "EXPORT_ID", Value: opts.ExportID},
							{Name: "EXPORT_TARGET", Value: opts.TargetName},
							{Name: "EXPORT_CLEANUP_DELAY_SECONDS", Value: strconv.Itoa(opts.DelaySeconds)},
						},
						VolumeMounts: []corev1.VolumeMount{{Name: "export", MountPath: root}},
					}},
				},
			},
		},
	}, nil
}
