// pkg/export_cleanup_test.go
package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/mux"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// exportVolume lays out a volume holding two exports, so a test can tell whether
// cleaning up one touched the other.
func exportVolume(t *testing.T) string {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "mine.ova"), "ova")
	writeTestFile(t, filepath.Join(root, ".vm-import-ui", "abc123", "status.json"), "{}")
	writeTestFile(t, filepath.Join(root, ".vm-import-ui", "abc123", "staging", "disk-0.vmdk"), "staged")
	writeTestFile(t, filepath.Join(root, "other.ova"), "ova")
	writeTestFile(t, filepath.Join(root, ".vm-import-ui", "def456", "status.json"), "{}")
	return root
}

func TestRemoveExportFiles_RemovesOnlyThatExport(t *testing.T) {
	root := exportVolume(t)
	if err := removeExportFiles(root, "abc123", "mine"); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"mine.ova", ".vm-import-ui/abc123"} {
		if exists(filepath.Join(root, gone)) {
			t.Errorf("%s should have been removed", gone)
		}
	}
	for _, kept := range []string{"other.ova", ".vm-import-ui/def456/status.json"} {
		if !exists(filepath.Join(root, kept)) {
			t.Errorf("%s belongs to another export and must be kept", kept)
		}
	}
}

func TestRemoveExportFiles_IsRepeatable(t *testing.T) {
	root := exportVolume(t)
	for i := 0; i < 2; i++ {
		if err := removeExportFiles(root, "abc123", "mine"); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}
	// A target that never produced an OVA (failed export) still cleans the status folder.
	root = exportVolume(t)
	if err := removeExportFiles(root, "abc123", ""); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(root, ".vm-import-ui", "abc123")) || !exists(filepath.Join(root, "mine.ova")) {
		t.Error("empty target should remove only the status folder")
	}
}

// An empty id would resolve the status folder to .vm-import-ui itself and wipe
// every export's state; a traversal would leave the volume. Neither may happen.
func TestRemoveExportFiles_RefusesUnsafeInput(t *testing.T) {
	cases := []struct{ name, id, target string }{
		{"empty id", "", "mine"},
		{"dot id", ".", "mine"},
		{"traversal id", "../abc123", "mine"},
		{"slash id", "abc/123", "mine"},
		{"uppercase id", "ABC123", "mine"},
		{"traversal target", "abc123", "../escape"},
		{"absolute-ish target", "abc123", "../../etc/passwd"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := exportVolume(t)
			outside := filepath.Join(filepath.Dir(root), "escape.ova")
			writeTestFile(t, outside, "must survive")
			defer os.Remove(outside)

			if err := removeExportFiles(root, c.id, c.target); err == nil {
				t.Error("expected an error")
			}
			for _, kept := range []string{"mine.ova", "other.ova", ".vm-import-ui/abc123/status.json", ".vm-import-ui/def456/status.json"} {
				if !exists(filepath.Join(root, kept)) {
					t.Errorf("%s was removed by a rejected request", kept)
				}
			}
			if !exists(outside) {
				t.Error("a file outside the export root was removed")
			}
		})
	}
}

func TestBuildExportCleanupJob(t *testing.T) {
	uid := int64(0)
	job, err := buildExportCleanupJob(ExportCleanupJobOptions{
		Namespace: "labs", Image: "img:1", ExportPVC: "exports", ExportID: "abc123",
		TargetName: "mine", DelaySeconds: 30, RunAsUser: &uid, FSGroup: &uid,
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.Namespace != "labs" || job.Name != "vm-export-cleanup-abc123" {
		t.Errorf("got %s/%s", job.Namespace, job.Name)
	}
	// It must not look like an export to the list endpoint.
	if _, ok := job.Labels[exportLabelMarker]; ok {
		t.Error("cleanup Job must not carry the export marker label, or it is listed as an export")
	}
	if job.Labels[exportLabelCleanup] != "abc123" {
		t.Errorf("missing cleanup label: %v", job.Labels)
	}
	if job.Spec.TTLSecondsAfterFinished == nil || *job.Spec.TTLSecondsAfterFinished <= 0 {
		t.Error("a cleanup Job records nothing and should expire")
	}
	pod := job.Spec.Template.Spec
	if pod.AutomountServiceAccountToken == nil || *pod.AutomountServiceAccountToken {
		t.Error("cleanup needs no API access")
	}
	if got := pod.Volumes[0].PersistentVolumeClaim.ClaimName; got != "exports" {
		t.Errorf("mounts PVC %q, want exports", got)
	}
	c := pod.Containers[0]
	if len(c.Command) != 2 || c.Command[1] != "export-cleanup" {
		t.Errorf("command = %v", c.Command)
	}
	env := map[string]string{}
	for _, e := range c.Env {
		env[e.Name] = e.Value
	}
	for k, want := range map[string]string{"EXPORT_ROOT": "/export", "EXPORT_ID": "abc123", "EXPORT_TARGET": "mine", "EXPORT_CLEANUP_DELAY_SECONDS": "30"} {
		if env[k] != want {
			t.Errorf("%s = %q, want %q", k, env[k], want)
		}
	}
}

func TestBuildExportCleanupJob_RejectsBadInput(t *testing.T) {
	ok := ExportCleanupJobOptions{Namespace: "labs", Image: "i", ExportPVC: "exports", ExportID: "abc123", TargetName: "mine"}
	if _, err := buildExportCleanupJob(ok); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*ExportCleanupJobOptions){
		"no pvc":           func(o *ExportCleanupJobOptions) { o.ExportPVC = "" },
		"empty id":         func(o *ExportCleanupJobOptions) { o.ExportID = "" },
		"traversal id":     func(o *ExportCleanupJobOptions) { o.ExportID = "../x" },
		"traversal target": func(o *ExportCleanupJobOptions) { o.TargetName = "../../x" },
	} {
		o := ok
		mutate(&o)
		if _, err := buildExportCleanupJob(o); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// ── handler ────────────────────────────────────────────────────────────────

func exportJobIn(ns, id, target string, active int32) *batchv1.Job {
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name: exportJobName(id), Namespace: ns,
			Labels:      map[string]string{exportLabelMarker: "true", exportLabelID: id},
			Annotations: map[string]string{exportAnnTargetName: target},
		},
		Status: batchv1.JobStatus{Active: active},
	}
}

func callDelete(t *testing.T, clients *K8sClients, ns, id, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/exports/"+ns+"/"+id+query, nil)
	req = mux.SetURLVars(req, map[string]string{"namespace": ns, "id": id})
	rec := httptest.NewRecorder()
	DeleteExportHandler(clients)(rec, req)
	return rec
}

func cleanupEnv(t *testing.T, root string) {
	t.Setenv("EXPORT_ROOT", root)
	t.Setenv("POD_NAMESPACE", "vm-import-ui")
	t.Setenv("EXPORT_PVC", "vm-import-ui-exports")
	t.Setenv("EXPORT_IMAGE", "img:1")
}

func jobExists(t *testing.T, clients *K8sClients, ns, name string) bool {
	t.Helper()
	_, err := clients.Clientset.BatchV1().Jobs(ns).Get(context.Background(), name, metav1.GetOptions{})
	return err == nil
}

// The regression: purging an export whose volume is NOT the one this pod mounts
// used to remove files from THIS pod's volume (here, a same-named OVA) and leave
// the real ones behind, after deleting the only record of the export.
func TestDeleteExport_PurgeInOtherNamespaceUsesCleanupJob(t *testing.T) {
	root := exportVolume(t) // this pod's own volume (namespace vm-import-ui)
	cleanupEnv(t, root)
	clients := newTestClients(exportJobIn("labs", "abc123", "mine", 0))

	rec := callDelete(t, clients, "labs", "abc123", "?purge=true")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	for _, kept := range []string{"mine.ova", "other.ova", ".vm-import-ui/abc123/status.json"} {
		if !exists(filepath.Join(root, kept)) {
			t.Errorf("%s on this pod's own volume was touched by an export in another namespace", kept)
		}
	}
	cj, err := clients.Clientset.BatchV1().Jobs("labs").Get(context.Background(), "vm-export-cleanup-abc123", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("expected a cleanup Job in the export's namespace: %v", err)
	}
	if got := cj.Spec.Template.Spec.Volumes[0].PersistentVolumeClaim.ClaimName; got != "vm-import-ui-exports" {
		t.Errorf("cleanup mounts %q", got)
	}
	if jobExists(t, clients, "labs", exportJobName("abc123")) {
		t.Error("the export Job should be deleted once cleanup is scheduled")
	}
}

func TestDeleteExport_PurgeInOwnNamespaceRemovesFilesHere(t *testing.T) {
	root := exportVolume(t)
	cleanupEnv(t, root)
	clients := newTestClients(exportJobIn("vm-import-ui", "abc123", "mine", 0))

	if rec := callDelete(t, clients, "vm-import-ui", "abc123", "?purge=true"); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if exists(filepath.Join(root, "mine.ova")) || exists(filepath.Join(root, ".vm-import-ui", "abc123")) {
		t.Error("files of the export should be removed")
	}
	if !exists(filepath.Join(root, "other.ova")) || !exists(filepath.Join(root, ".vm-import-ui", "def456", "status.json")) {
		t.Error("another export's files were removed")
	}
	if jobExists(t, clients, "vm-import-ui", "vm-export-cleanup-abc123") {
		t.Error("no cleanup Job is needed when the volume is mounted here")
	}
	if jobExists(t, clients, "vm-import-ui", exportJobName("abc123")) {
		t.Error("export Job should be deleted")
	}
}

func TestDeleteExport_WithoutPurgeKeepsFiles(t *testing.T) {
	root := exportVolume(t)
	cleanupEnv(t, root)
	for _, ns := range []string{"vm-import-ui", "labs"} {
		clients := newTestClients(exportJobIn(ns, "abc123", "mine", 0))
		if rec := callDelete(t, clients, ns, "abc123", ""); rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", ns, rec.Code)
		}
		if !exists(filepath.Join(root, "mine.ova")) {
			t.Errorf("%s: files must be kept without purge", ns)
		}
		if jobExists(t, clients, ns, "vm-export-cleanup-abc123") {
			t.Errorf("%s: no cleanup Job without purge", ns)
		}
		if jobExists(t, clients, ns, exportJobName("abc123")) {
			t.Errorf("%s: export Job should be deleted", ns)
		}
	}
}

// The export Job is the only record. If cleanup cannot be scheduled it must stay,
// or the OVA is stranded with nothing left to retry from.
func TestDeleteExport_KeepsExportWhenCleanupCannotBeScheduled(t *testing.T) {
	cleanupEnv(t, exportVolume(t))
	clients := newTestClients(exportJobIn("labs", "abc123", "mine", 0))
	clients.Clientset.(*fake.Clientset).PrependReactor("create", "jobs",
		func(ktesting.Action) (bool, runtime.Object, error) {
			return true, nil, fmt.Errorf("quota exceeded")
		})

	rec := callDelete(t, clients, "labs", "abc123", "?purge=true")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", rec.Code)
	}
	if !jobExists(t, clients, "labs", exportJobName("abc123")) {
		t.Error("the export Job must be kept so the delete can be retried")
	}
}

func TestDeleteExport_RepeatedPurgeIsAccepted(t *testing.T) {
	cleanupEnv(t, exportVolume(t))
	existing := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "vm-export-cleanup-abc123", Namespace: "labs"}}
	clients := newTestClients(exportJobIn("labs", "abc123", "mine", 0), existing)
	if rec := callDelete(t, clients, "labs", "abc123", "?purge=true"); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteExport_PurgeOfRunningExportDelaysCleanup(t *testing.T) {
	cleanupEnv(t, exportVolume(t))
	clients := newTestClients(exportJobIn("labs", "abc123", "mine", 1))
	if rec := callDelete(t, clients, "labs", "abc123", "?purge=true"); rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	cj, err := clients.Clientset.BatchV1().Jobs("labs").Get(context.Background(), "vm-export-cleanup-abc123", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var delay string
	for _, e := range cj.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "EXPORT_CLEANUP_DELAY_SECONDS" {
			delay = e.Value
		}
	}
	if delay != fmt.Sprint(exportCleanupActiveDelay) {
		t.Errorf("delay = %q: a running export's pod must be given time to stop first", delay)
	}
}

func TestDeleteExport_UnknownExportIs404(t *testing.T) {
	cleanupEnv(t, exportVolume(t))
	if rec := callDelete(t, newTestClients(), "labs", "abc123", "?purge=true"); rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", rec.Code)
	}
}
