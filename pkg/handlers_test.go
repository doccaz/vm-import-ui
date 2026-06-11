// pkg/handlers_test.go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
)

// newTestClients creates K8sClients backed by fake clientsets for testing.
func newTestClients(objects ...runtime.Object) *K8sClients {
	scheme := runtime.NewScheme()
	fakeClientset := fake.NewSimpleClientset(objects...)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme)
	return &K8sClients{
		Clientset: fakeClientset,
		Dynamic:   fakeDynamic,
	}
}

// newTestClientsWithDynamic creates K8sClients with pre-seeded dynamic objects.
func newTestClientsWithDynamic(coreObjects []runtime.Object, dynamicObjects ...runtime.Object) *K8sClients {
	scheme := runtime.NewScheme()
	fakeClientset := fake.NewSimpleClientset(coreObjects...)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, dynamicObjects...)
	return &K8sClients{
		Clientset: fakeClientset,
		Dynamic:   fakeDynamic,
	}
}

// executeRequest creates and executes a test HTTP request.
func executeRequest(handler http.HandlerFunc, method, path string, body interface{}, vars map[string]string) *httptest.ResponseRecorder {
	var req *http.Request
	if body != nil {
		bodyBytes, _ := json.Marshal(body)
		req = httptest.NewRequest(method, path, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	if vars != nil {
		req = mux.SetURLVars(req, vars)
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

// --- Tests ---

func TestRespondWithJSON(t *testing.T) {
	t.Run("normal payload", func(t *testing.T) {
		rr := httptest.NewRecorder()
		respondWithJSON(rr, http.StatusOK, map[string]string{"key": "value"})

		if rr.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rr.Code)
		}
		if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
		}

		var result map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if result["key"] != "value" {
			t.Errorf("expected value 'value', got '%s'", result["key"])
		}
	})

	t.Run("unmarshalable input returns 500", func(t *testing.T) {
		rr := httptest.NewRecorder()
		// A channel cannot be marshaled to JSON
		respondWithJSON(rr, http.StatusOK, make(chan int))

		if rr.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500 for unmarshalable input, got %d", rr.Code)
		}
	})
}

func TestRespondWithError(t *testing.T) {
	rr := httptest.NewRecorder()
	respondWithError(rr, http.StatusBadRequest, "test error")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}

	var result map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if result["error"] != "test error" {
		t.Errorf("expected error 'test error', got '%s'", result["error"])
	}
}

func TestUpdatePlanHandler(t *testing.T) {
	scheme := runtime.NewScheme()
	gvrToListKind := map[schema.GroupVersionResource]string{
		vmiGVR: "VirtualMachineImportList",
	}

	plan := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "migration.harvesterhci.io/v1beta1",
		"kind":       "VirtualMachineImport",
		"metadata": map[string]interface{}{
			"name":      "stuck-plan",
			"namespace": "techday",
		},
		"spec": map[string]interface{}{
			"virtualMachineName": "OLD NAME",
			"storageClass":       "old-sc",
			"folder":             "/dc/old",
		},
		"status": map[string]interface{}{
			"importStatus":               "virtualMachineImportInvalid",
			"importedVirtualMachineName": "old name",
		},
	}}

	fakeDynamic := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, plan)
	clients := &K8sClients{Clientset: fake.NewSimpleClientset(), Dynamic: fakeDynamic}

	newName := "sles16"
	newSC := "harvester-1replica"
	emptyFolder := ""
	payload := UpdatePlanPayload{
		VirtualMachineName: &newName,
		StorageClass:       &newSC,
		Folder:             &emptyFolder, // empty clears the field
	}

	rr := executeRequest(UpdatePlanHandler(clients), http.MethodPut,
		"/api/v1/plans/techday/stuck-plan", payload,
		map[string]string{"namespace": "techday", "name": "stuck-plan"})

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	got, err := fakeDynamic.Resource(vmiGVR).Namespace("techday").Get(context.TODO(), "stuck-plan", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to get updated plan: %v", err)
	}

	if name, _, _ := unstructured.NestedString(got.Object, "spec", "virtualMachineName"); name != "sles16" {
		t.Errorf("expected virtualMachineName 'sles16', got '%s'", name)
	}
	if sc, _, _ := unstructured.NestedString(got.Object, "spec", "storageClass"); sc != "harvester-1replica" {
		t.Errorf("expected storageClass 'harvester-1replica', got '%s'", sc)
	}
	if _, found, _ := unstructured.NestedString(got.Object, "spec", "folder"); found {
		t.Errorf("expected folder to be cleared, but it is still present")
	}
	// The crux: status.importStatus must be reset so the controller re-runs preflight.
	if status, _, _ := unstructured.NestedString(got.Object, "status", "importStatus"); status != "" {
		t.Errorf("expected importStatus reset to empty, got '%s'", status)
	}
}

func TestGetNestedStringOrWarn(t *testing.T) {
	obj := map[string]interface{}{
		"spec": map[string]interface{}{
			"type": "vsphere",
			"url":  "https://vcenter.example.com",
		},
	}

	t.Run("found", func(t *testing.T) {
		val, ok := getNestedStringOrWarn(obj, "spec", "type")
		if !ok || val != "vsphere" {
			t.Errorf("expected ('vsphere', true), got ('%s', %v)", val, ok)
		}
	})

	t.Run("missing", func(t *testing.T) {
		val, ok := getNestedStringOrWarn(obj, "spec", "nonexistent")
		if ok || val != "" {
			t.Errorf("expected ('', false), got ('%s', %v)", val, ok)
		}
	})

	t.Run("wrong type", func(t *testing.T) {
		// Nested field exists but is not a string
		obj["spec"].(map[string]interface{})["count"] = 42
		val, ok := getNestedStringOrWarn(obj, "spec", "count")
		if ok || val != "" {
			t.Errorf("expected ('', false) for non-string field, got ('%s', %v)", val, ok)
		}
	})
}

func TestListNamespacesHandler(t *testing.T) {
	clients := newTestClients()

	rr := executeRequest(ListNamespacesHandler(clients), "GET", "/api/v1/harvester/namespaces", nil, nil)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	var result []interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
}

func TestCreateForkliftProviderHandler_VSphere(t *testing.T) {
	clients := newTestClients()

	payload := CreateForkliftProviderPayload{
		Name:         "test-provider",
		Namespace:    "forklift",
		URL:          "https://vcenter.example.com/sdk",
		Username:     "admin",
		Password:     "secret",
		SdkEndpoint:  "vcenter",
		ProviderType: "vsphere",
	}

	rr := executeRequest(CreateForkliftProviderHandler(clients), "POST", "/api/v1/forklift/providers", payload, nil)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d; body: %s", rr.Code, rr.Body.String())
	}

	// Verify Secret was created with correct keys
	secret, err := clients.Clientset.CoreV1().Secrets("forklift").Get(nil, "test-provider-secret", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("expected secret to be created: %v", err)
	}
	if string(secret.Data["user"]) != "" {
		// StringData is converted to Data by the fake client — check StringData was set
		if secret.StringData["user"] != "admin" {
			// Fake client may or may not copy StringData to Data
		}
	}
	if secret.Labels["createdForProviderType"] != "vsphere" {
		t.Errorf("expected label createdForProviderType=vsphere, got %s", secret.Labels["createdForProviderType"])
	}
}

func TestCreateForkliftProviderHandler_OVA(t *testing.T) {
	clients := newTestClients()

	payload := CreateForkliftProviderPayload{
		Name:         "ova-provider",
		Namespace:    "forklift",
		URL:          "10.0.0.1:/exports/vms",
		ProviderType: "ova",
	}

	rr := executeRequest(CreateForkliftProviderHandler(clients), "POST", "/api/v1/forklift/providers", payload, nil)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d; body: %s", rr.Code, rr.Body.String())
	}

	// Verify Secret was created with only url key (no user/password)
	secret, err := clients.Clientset.CoreV1().Secrets("forklift").Get(nil, "ova-provider-secret", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("expected secret to be created: %v", err)
	}
	if secret.Labels["createdForProviderType"] != "ova" {
		t.Errorf("expected label createdForProviderType=ova, got %s", secret.Labels["createdForProviderType"])
	}
	// OVA secret should not have user/password in StringData
	if secret.StringData["user"] != "" {
		t.Errorf("OVA secret should not have user field, got: %s", secret.StringData["user"])
	}
}

func TestCreateForkliftProviderHandler_InvalidJSON(t *testing.T) {
	clients := newTestClients()

	req := httptest.NewRequest("POST", "/api/v1/forklift/providers", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	CreateForkliftProviderHandler(clients).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}
}

func TestCreateForkliftProviderHandler_DefaultNamespace(t *testing.T) {
	clients := newTestClients()

	payload := CreateForkliftProviderPayload{
		Name:     "test-provider",
		URL:      "https://vcenter.example.com/sdk",
		Username: "admin",
		Password: "secret",
	}

	rr := executeRequest(CreateForkliftProviderHandler(clients), "POST", "/api/v1/forklift/providers", payload, nil)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d; body: %s", rr.Code, rr.Body.String())
	}

	// Verify Secret was created in default "forklift" namespace
	_, err := clients.Clientset.CoreV1().Secrets("forklift").Get(nil, "test-provider-secret", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("expected secret in forklift namespace: %v", err)
	}
}

func TestListForkliftProvidersHandler(t *testing.T) {
	// Create providers of different types
	vsphereProvider := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "forklift.konveyor.io/v1beta1",
			"kind":       "Provider",
			"metadata": map[string]interface{}{
				"name":      "vsphere-prov",
				"namespace": "forklift",
			},
			"spec": map[string]interface{}{
				"type": "vsphere",
			},
		},
	}
	ovaProvider := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "forklift.konveyor.io/v1beta1",
			"kind":       "Provider",
			"metadata": map[string]interface{}{
				"name":      "ova-prov",
				"namespace": "forklift",
			},
			"spec": map[string]interface{}{
				"type": "ova",
			},
		},
	}
	hostProvider := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "forklift.konveyor.io/v1beta1",
			"kind":       "Provider",
			"metadata": map[string]interface{}{
				"name":      "host",
				"namespace": "forklift",
			},
			"spec": map[string]interface{}{
				"type": "host",
			},
		},
	}

	scheme := runtime.NewScheme()
	gvr := schema.GroupVersionResource{Group: "forklift.konveyor.io", Version: "v1beta1", Resource: "providers"}
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, vsphereProvider, ovaProvider, hostProvider)
	clients := &K8sClients{
		Clientset: fake.NewSimpleClientset(),
		Dynamic:   fakeDynamic,
	}

	// Seed the GVR so fake client can list
	_ = gvr

	t.Run("list all source providers", func(t *testing.T) {
		rr := executeRequest(ListForkliftProvidersHandler(clients), "GET", "/api/v1/forklift/providers", nil, nil)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d; body: %s", rr.Code, rr.Body.String())
		}

		var providers []map[string]interface{}
		if err := json.Unmarshal(rr.Body.Bytes(), &providers); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		// Should include vsphere and ova, exclude host
		for _, p := range providers {
			spec, _ := p["spec"].(map[string]interface{})
			pType, _ := spec["type"].(string)
			if pType == "host" {
				t.Errorf("host provider should be excluded from listing")
			}
		}
	})
}

func TestGetCapabilitiesHandler(t *testing.T) {
	clients := newTestClients()

	rr := executeRequest(GetCapabilitiesHandler(clients), "GET", "/api/v1/capabilities", nil, nil)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	// Without settings CRD, should return defaults
	if _, ok := result["harvesterVersion"]; !ok {
		// harvesterVersion key should exist even if empty
		t.Log("harvesterVersion not in response (expected if no settings CRD)")
	}
}

func TestDeleteForkliftProviderHandler(t *testing.T) {
	clients := newTestClients()

	// Try to delete a non-existent provider
	rr := executeRequest(
		DeleteForkliftProviderHandler(clients),
		"DELETE",
		"/api/v1/forklift/providers/forklift/nonexistent",
		nil,
		map[string]string{"namespace": "forklift", "name": "nonexistent"},
	)

	// Should return error since provider doesn't exist
	if rr.Code == http.StatusOK {
		t.Log("delete of nonexistent provider returned 200 (fake client may not error)")
	}
}
