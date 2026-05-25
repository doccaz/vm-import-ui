// pkg/support_bundle_test.go
package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
)

// readBundle gunzips + untars a support bundle response into a path→contents map.
func readBundle(t *testing.T, raw []byte) map[string]string {
	t.Helper()
	gz, err := gzip.NewReader(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("not a valid gzip stream: %v", err)
	}
	tr := tar.NewReader(gz)
	files := map[string]string{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar read error: %v", err)
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("tar entry read error: %v", err)
		}
		files[hdr.Name] = string(data)
	}
	return files
}

func findFile(files map[string]string, suffix string) (string, string, bool) {
	for name, content := range files {
		if strings.HasSuffix(name, suffix) {
			return name, content, true
		}
	}
	return "", "", false
}

func TestSupportBundleHandler(t *testing.T) {
	const secretValue = "super-secret-vcenter-password"

	secret := &v1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "vcenter-creds", Namespace: "default"},
		Type:       v1.SecretTypeOpaque,
		Data: map[string][]byte{
			"username": []byte("administrator@vsphere.local"),
			"password": []byte(secretValue),
		},
	}

	// An unrelated secret not referenced by any source/provider — must be excluded.
	unrelated := &v1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "rancher-token", Namespace: "cattle-system"},
		Type:       v1.SecretTypeOpaque,
		Data:       map[string][]byte{"token": []byte("unrelated-token-value")},
	}

	vmi := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "migration.harvesterhci.io/v1beta1",
		"kind":       "VirtualMachineImport",
		"metadata":   map[string]interface{}{"name": "teste", "namespace": "devops"},
		"spec": map[string]interface{}{
			"virtualMachineName": "VMDEVOPSTSTWIN01",
			"storageClass":       "harvester-longhorn2",
		},
		"status": map[string]interface{}{"importStatus": "virtualMachineImportInvalid"},
	}}

	source := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "migration.harvesterhci.io/v1beta1",
		"kind":       "VmwareSource",
		"metadata":   map[string]interface{}{"name": "import-vcenter", "namespace": "default"},
		"spec": map[string]interface{}{
			"endpoint":    "https://vcenter.example.com/sdk",
			"credentials": map[string]interface{}{"name": "vcenter-creds", "namespace": "default"},
		},
	}}

	clients := newTestClientsWithDynamic([]runtime.Object{secret, unrelated}, vmi, source)

	rr := executeRequest(SupportBundleHandler(clients), "GET", "/api/v1/support-bundle", nil, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/gzip" {
		t.Errorf("expected Content-Type application/gzip, got %q", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, "vm-import-support-") || !strings.Contains(cd, ".tar.gz") {
		t.Errorf("unexpected Content-Disposition: %q", cd)
	}

	raw := rr.Body.Bytes()
	files := readBundle(t, raw)

	// Required structural files.
	if _, _, ok := findFile(files, "/meta.json"); !ok {
		t.Error("bundle missing meta.json")
	}
	if _, _, ok := findFile(files, "/errors.json"); !ok {
		t.Error("bundle missing errors.json")
	}

	// The VMIC plan CR is captured, including its invalid status (the bug signal).
	_, planContent, ok := findFile(files, "plans/vmic/devops_teste.json")
	if !ok {
		t.Fatal("bundle missing plans/vmic/devops_teste.json")
	}
	if !strings.Contains(planContent, "VMDEVOPSTSTWIN01") {
		t.Error("plan CR should preserve the raw virtualMachineName")
	}
	if !strings.Contains(planContent, "virtualMachineImportInvalid") {
		t.Error("plan CR should include status conditions")
	}

	// Secret metadata is present with key names but NEVER values.
	_, secretContent, ok := findFile(files, "secrets/default_vcenter-creds.json")
	if !ok {
		t.Fatal("bundle missing secrets/default_vcenter-creds.json")
	}
	var secretMeta map[string]interface{}
	if err := json.Unmarshal([]byte(secretContent), &secretMeta); err != nil {
		t.Fatalf("secret metadata not valid JSON: %v", err)
	}
	keys, _ := secretMeta["dataKeys"].([]interface{})
	if len(keys) != 2 {
		t.Errorf("expected 2 redacted data keys, got %v", secretMeta["dataKeys"])
	}

	// Scoping: a secret not referenced by any source/provider must NOT be collected.
	if _, _, ok := findFile(files, "secrets/cattle-system_rancher-token.json"); ok {
		t.Error("unreferenced secret should be excluded from the bundle")
	}

	// The crucial guarantee: the secret VALUE must not appear anywhere in the bundle.
	for name, content := range files {
		if strings.Contains(content, secretValue) {
			t.Fatalf("secret value leaked into bundle file %s", name)
		}
	}
}

func TestSupportBundleAnonymizesInventory(t *testing.T) {
	salt := newAnonSalt(true)
	tree := &InventoryNode{
		Name: "BQE-DATACENTER",
		Type: "datacenter",
		Children: []InventoryNode{
			{
				Name:          "VMDEVOPSTSTWIN01",
				Type:          "VirtualMachine",
				Folder:        "DESENVOLVIMENTO/WINDOWS/DEVOPS",
				DatastoreID:   "datastore-10061",
				DatastoreName: "SVT_DS_SERVICOS_06",
				Networks: []VMNetwork{
					{Name: "VM Network - VLAN16", ID: "network-97256", MAC: "00:50:56:9e:f5:aa", Key: 4000},
				},
			},
		},
	}

	anonymizeInventory(tree, salt)
	vm := tree.Children[0]

	if vm.Name == "VMDEVOPSTSTWIN01" {
		t.Error("VM name should be hashed")
	}
	if strings.Contains(vm.Folder, "DEVOPS") {
		t.Error("folder should be hashed")
	}
	if vm.Networks[0].Name == "VM Network - VLAN16" {
		t.Error("network name should be hashed")
	}
	// IDs and structure are preserved so mapping/structural bugs still reproduce.
	if vm.Networks[0].ID != "network-97256" {
		t.Error("network ID must be preserved for mapping reproduction")
	}
	if vm.DatastoreID != "datastore-10061" {
		t.Error("datastore ID must be preserved")
	}
}
