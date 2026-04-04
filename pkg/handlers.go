// pkg/handlers.go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
)

var (
	vmiGVR = schema.GroupVersionResource{
		Group:    "migration.harvesterhci.io",
		Version:  "v1beta1",
		Resource: "virtualmachineimports",
	}
	vmwareSourceGVR = schema.GroupVersionResource{
		Group:    "migration.harvesterhci.io",
		Version:  "v1beta1",
		Resource: "vmwaresources",
	}
	ovaSourceGVR = schema.GroupVersionResource{
		Group:    "migration.harvesterhci.io",
		Version:  "v1beta1",
		Resource: "ovasources",
	}
	vmGVR = schema.GroupVersionResource{
		Group:    "kubevirt.io",
		Version:  "v1",
		Resource: "virtualmachines",
	}
	// NEW: To check cluster version
	settingsGVR = schema.GroupVersionResource{
		Group:    "harvesterhci.io",
		Version:  "v1beta1",
		Resource: "settings",
	}

	// Forklift GVRs
	forkliftProviderGVR = schema.GroupVersionResource{
		Group:    "forklift.konveyor.io",
		Version:  "v1beta1",
		Resource: "providers",
	}
	forkliftPlanGVR = schema.GroupVersionResource{
		Group:    "forklift.konveyor.io",
		Version:  "v1beta1",
		Resource: "plans",
	}
	forkliftNetworkMapGVR = schema.GroupVersionResource{
		Group:    "forklift.konveyor.io",
		Version:  "v1beta1",
		Resource: "networkmaps",
	}
	forkliftStorageMapGVR = schema.GroupVersionResource{
		Group:    "forklift.konveyor.io",
		Version:  "v1beta1",
		Resource: "storagemaps",
	}
	forkliftMigrationGVR = schema.GroupVersionResource{
		Group:    "forklift.konveyor.io",
		Version:  "v1beta1",
		Resource: "migrations",
	}
)

// Helper to respond with JSON
func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		log.Errorf("Failed to marshal JSON response: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		if _, writeErr := w.Write([]byte(`{"error":"internal server error: failed to marshal response"}`)); writeErr != nil {
			log.Warnf("Failed to write error response: %v", writeErr)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if _, writeErr := w.Write(response); writeErr != nil {
		log.Warnf("Failed to write response body: %v", writeErr)
	}
}

// Helper to respond with a JSON error
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
}

// getNestedStringOrWarn extracts a nested string from an unstructured object.
// Returns the value and true if found, or "" and false (with a debug log) if missing.
func getNestedStringOrWarn(obj map[string]interface{}, fields ...string) (string, bool) {
	val, found, err := unstructured.NestedString(obj, fields...)
	if err != nil {
		log.Warnf("Error reading field %v: %v", fields, err)
		return "", false
	}
	if !found {
		log.Debugf("Field %v not found in object", fields)
		return "", false
	}
	return val, true
}

// NEW: Capability configuration to send to frontend
type CapabilityConfig struct {
	HarvesterVersion string `json:"harvesterVersion"`
	HasAdvancedPower bool   `json:"hasAdvancedPower"` // v1.6.0+
}

// NEW: Handler to check Harvester version and features
func GetCapabilitiesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		// 1. Fetch the 'server-version' setting
		setting, err := clients.Dynamic.Resource(settingsGVR).Get(context.TODO(), "server-version", metav1.GetOptions{})
		if err != nil {
			// If we fail to check (e.g., permissions or very old cluster), assume old version
			log.Warnf("Could not determine Harvester version: %v", err)
			respondWithJSON(w, http.StatusOK, CapabilityConfig{HarvesterVersion: "unknown", HasAdvancedPower: false})
			return
		}

		// 2. Extract the value
		version, _ := getNestedStringOrWarn(setting.Object, "value")

		// 3. Check logic: Is this v1.6.0 or newer?
		// Simple check looks for "v1.6", "v1.7", "master" or newer versions.
		hasAdvanced := strings.Contains(version, "v1.6") ||
			strings.Contains(version, "v1.7") ||
			strings.Contains(version, "v1.8") ||
			strings.Contains(version, "v1.9") ||
			strings.Contains(version, "master")

		respondWithJSON(w, http.StatusOK, CapabilityConfig{
			HarvesterVersion: version,
			HasAdvancedPower: hasAdvanced,
		})
	}
}

type VCenterCredentials struct {
	URL        string
	Username   string
	Password   string
	Datacenter string
}

func HandleGetInventory(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching inventory for VmwareSource %s/%s", namespace, name)

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}

		endpoint, found := getNestedStringOrWarn(sourceObj.Object, "spec", "endpoint")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing spec.endpoint")
			return
		}
		datacenter, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "dc")

		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}
		secretNamespace, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "namespace")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret namespace")
			return
		}

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get credentials secret: "+err.Error())
			return
		}

		creds := VCenterCredentials{
			URL:        endpoint,
			Username:   string(secret.Data["username"]),
			Password:   string(secret.Data["password"]),
			Datacenter: datacenter,
		}

		inventory, err := GetVCenterInventory(r.Context(), creds)
		if err != nil {
			log.Errorf("Failed to get vCenter inventory: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, inventory)
	}
}

func CreatePlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var plan VirtualMachineImport
		if err := json.NewDecoder(r.Body).Decode(&plan); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Creating VirtualMachineImport CR: %s in namespace %s", plan.ObjectMeta.Name, plan.ObjectMeta.Namespace)
		log.Debugf("Received plan payload: %+v", plan)

		unstructuredObj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&plan)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to convert plan to unstructured object: "+err.Error())
			return
		}

		createdObj, err := clients.Dynamic.Resource(vmiGVR).Namespace(plan.ObjectMeta.Namespace).Create(context.TODO(), &unstructured.Unstructured{Object: unstructuredObj}, metav1.CreateOptions{})
		if err != nil {
			log.Errorf("Failed to create VirtualMachineImport CR: %v", err)
			respondWithError(w, http.StatusInternalServerError, "Failed to create VirtualMachineImport CR: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

func ListPlansHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(vmiGVR).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VirtualMachineImport CRs: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

func DeletePlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Deleting VirtualMachineImport CR: %s in namespace %s", name, namespace)
		err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func RunPlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Triggering 'Run Now' for VirtualMachineImport CR: %s in namespace %s", name, namespace)

		item, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		unstructured.RemoveNestedField(item.Object, "spec", "schedule")

		updatedItem, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Update(context.TODO(), item, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedItem)
	}
}

func ListVmwareSourcesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(vmwareSourceGVR).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VmwareSource CRs: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

type CreateVmwareSourcePayload struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Endpoint   string `json:"endpoint"`
	Datacenter string `json:"datacenter"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

func CreateVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload CreateVmwareSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		// 1. Create the Secret
		secretName := payload.Name + "-credentials"
		secret := &v1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: payload.Namespace,
			},
			StringData: map[string]string{
				"username": payload.Username,
				"password": payload.Password,
			},
		}
		_, err := clients.Clientset.CoreV1().Secrets(payload.Namespace).Create(context.TODO(), secret, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create credentials secret: "+err.Error())
			return
		}

		// 2. Create the VmwareSource
		vmwareSource := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "migration.harvesterhci.io/v1beta1",
				"kind":       "VmwareSource",
				"metadata": map[string]interface{}{
					"name":      payload.Name,
					"namespace": payload.Namespace,
				},
				"spec": map[string]interface{}{
					"endpoint": payload.Endpoint,
					"dc":       payload.Datacenter,
					"credentials": map[string]interface{}{
						"name":      secretName,
						"namespace": payload.Namespace,
					},
				},
			},
		}

		createdObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(payload.Namespace).Create(context.TODO(), vmwareSource, metav1.CreateOptions{})
		if err != nil {
			// Clean up the secret if source creation fails
			if cleanupErr := clients.Clientset.CoreV1().Secrets(payload.Namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete secret %s/%s: %v", payload.Namespace, secretName, cleanupErr)
			}
			respondWithError(w, http.StatusInternalServerError, "Failed to create VmwareSource CR: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

func GetVmwareSourceDetails(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get VmwareSource: "+err.Error())
			return
		}

		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}
		secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
			return
		}

		sourceObj.Object["spec"].(map[string]interface{})["username"] = string(secret.Data["username"])

		respondWithJSON(w, http.StatusOK, sourceObj)
	}
}

func UpdateVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var payload CreateVmwareSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		// 1. Get the existing VmwareSource to find the secret name
		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get VmwareSource: "+err.Error())
			return
		}
		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}

		// 2. Update the Secret, only if new credentials are provided
		if payload.Username != "" || payload.Password != "" {
			secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
				return
			}

			if secret.StringData == nil {
				secret.StringData = make(map[string]string)
			}

			if payload.Username != "" {
				secret.StringData["username"] = payload.Username
			}
			if payload.Password != "" {
				secret.StringData["password"] = payload.Password
			}
			_, err = clients.Clientset.CoreV1().Secrets(namespace).Update(context.TODO(), secret, metav1.UpdateOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to update secret: "+err.Error())
				return
			}
		}

		// 3. Update the VmwareSource
		if err := unstructured.SetNestedField(sourceObj.Object, payload.Endpoint, "spec", "endpoint"); err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to set endpoint: "+err.Error())
			return
		}
		if err := unstructured.SetNestedField(sourceObj.Object, payload.Datacenter, "spec", "dc"); err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to set datacenter: "+err.Error())
			return
		}

		updatedObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Update(context.TODO(), sourceObj, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to update VmwareSource: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedObj)
	}
}

func DeleteVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		// 1. Get the VmwareSource to find the associated secret
		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}
		secretName, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")

		// 2. Delete the VmwareSource
		err = clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete VmwareSource: "+err.Error())
			return
		}

		// 3. Delete the associated Secret
		if secretName != "" {
			err = clients.Clientset.CoreV1().Secrets(namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{})
			if err != nil {
				// Log the error but don't fail the request, as the primary resource was deleted.
				log.Warnf("Failed to delete associated secret %s/%s: %v", namespace, secretName, err)
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func ListNamespacesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		namespaces, err := clients.Clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, namespaces.Items)
	}
}

func CreateNamespaceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Creating namespace: %s", payload.Name)
		nsSpec := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: payload.Name}}
		_, err := clients.Clientset.CoreV1().Namespaces().Create(context.TODO(), nsSpec, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, map[string]string{"status": "namespace created"})
	}
}

func ListVlanConfigsHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Listing Harvester VlanConfigs")
		gvr := schema.GroupVersionResource{
			Group:    "k8s.cni.cncf.io",
			Version:  "v1",
			Resource: "network-attachment-definitions",
		}

		listOptions := metav1.ListOptions{
			LabelSelector: "network.harvesterhci.io/type=L2VlanNetwork",
		}

		list, err := clients.Dynamic.Resource(gvr).Namespace("").List(context.TODO(), listOptions)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		log.Debugf("Fetched VLAN definitions: %+v", list.Items)
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

func ListStorageClassesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scs, err := clients.Clientset.StorageV1().StorageClasses().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, scs.Items)
	}
}

func HandleGetPlanLogs(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching logs related to plan %s/%s", namespace, name)

		// 1. Get the plan to find its source
		planObj, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get plan: "+err.Error())
			return
		}
		sourceName, _ := getNestedStringOrWarn(planObj.Object, "spec", "sourceCluster", "name")
		sourceNamespace, _ := getNestedStringOrWarn(planObj.Object, "spec", "sourceCluster", "namespace")

		// 2. Find the controller pod
		pods, err := clients.Clientset.CoreV1().Pods("harvester-system").List(context.TODO(), metav1.ListOptions{
			LabelSelector: "app.kubernetes.io/name=harvester-vm-import-controller",
		})
		if err != nil || len(pods.Items) == 0 {
			respondWithError(w, http.StatusInternalServerError, "Could not find vm-import-controller pod")
			return
		}
		podName := pods.Items[0].Name

		// 3. Fetch logs from the pod
		req := clients.Clientset.CoreV1().Pods("harvester-system").GetLogs(podName, &v1.PodLogOptions{})
		podLogs, err := req.Stream(context.TODO())
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to stream pod logs: "+err.Error())
			return
		}
		defer podLogs.Close()

		// 4. Filter logs for the specific plan and its source
		var logOutput strings.Builder
		scanner := bufio.NewScanner(podLogs)
		planSearchString := fmt.Sprintf("'%s/%s'", namespace, name)
		sourceSearchString := fmt.Sprintf("'%s/%s'", sourceNamespace, sourceName)
		showAll := r.URL.Query().Get("all") == "true"

		for scanner.Scan() {
			line := scanner.Text()
			if showAll || strings.Contains(line, planSearchString) || strings.Contains(line, sourceSearchString) {
				logOutput.WriteString(line + "\n")
			}
		}

		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(logOutput.String())); err != nil {
			log.Warnf("Failed to write response: %v", err)
		}
	}
}

func HandleGetPlanYAML(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching YAML for plan %s/%s", namespace, name)

		item, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Convert unstructured object to YAML
		yamlBytes, err := yaml.Marshal(item.Object)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to marshal plan to YAML: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/yaml")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(yamlBytes); err != nil {
			log.Warnf("Failed to write response: %v", err)
		}
	}
}

// HandleGetResource returns a namespaced resource as JSON
func HandleGetResource(clients *K8sClients, gvr schema.GroupVersionResource) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		item, err := clients.Dynamic.Resource(gvr).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, item.Object)
	}
}

func HandleGetSourceYAML(clients *K8sClients, gvr schema.GroupVersionResource) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching YAML for source %s/%s", namespace, name)

		item, err := clients.Dynamic.Resource(gvr).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		yamlBytes, err := yaml.Marshal(item.Object)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to marshal source to YAML: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/yaml")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(yamlBytes); err != nil {
			log.Warnf("Failed to write response: %v", err)
		}
	}
}

func ListVMsHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		list, err := clients.Dynamic.Resource(vmGVR).Namespace(namespace).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VirtualMachines: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

// --- OvaSource Handlers ---

func ListOvaSourcesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(ovaSourceGVR).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list OvaSource CRs: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

type CreateOvaSourcePayload struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	URL                string `json:"url"`
	HttpTimeoutSeconds int    `json:"httpTimeoutSeconds,omitempty"`
	Username           string `json:"username"`
	Password           string `json:"password"`
}

func CreateOvaSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload CreateOvaSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		// 1. Create the Secret
		secretName := payload.Name + "-ova-credentials"
		secret := &v1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: payload.Namespace,
			},
			StringData: map[string]string{
				"username": payload.Username,
				"password": payload.Password,
			},
		}
		_, err := clients.Clientset.CoreV1().Secrets(payload.Namespace).Create(context.TODO(), secret, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create credentials secret: "+err.Error())
			return
		}

		// 2. Create the OvaSource
		ovaSource := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "migration.harvesterhci.io/v1beta1",
				"kind":       "OvaSource",
				"metadata": map[string]interface{}{
					"name":      payload.Name,
					"namespace": payload.Namespace,
				},
				"spec": map[string]interface{}{
					"url": payload.URL,
					"credentials": map[string]interface{}{
						"name":      secretName,
						"namespace": payload.Namespace,
					},
				},
			},
		}
		if payload.HttpTimeoutSeconds > 0 {
			ovaSource.Object["spec"].(map[string]interface{})["httpTimeoutSeconds"] = int64(payload.HttpTimeoutSeconds)
		}

		createdObj, err := clients.Dynamic.Resource(ovaSourceGVR).Namespace(payload.Namespace).Create(context.TODO(), ovaSource, metav1.CreateOptions{})
		if err != nil {
			if cleanupErr := clients.Clientset.CoreV1().Secrets(payload.Namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete secret %s/%s: %v", payload.Namespace, secretName, cleanupErr)
			}
			respondWithError(w, http.StatusInternalServerError, "Failed to create OvaSource CR: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

func GetOvaSourceDetails(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		sourceObj, err := clients.Dynamic.Resource(ovaSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get OvaSource: "+err.Error())
			return
		}

		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "OvaSource missing credentials secret name")
			return
		}
		secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
			return
		}

		sourceObj.Object["spec"].(map[string]interface{})["username"] = string(secret.Data["username"])

		respondWithJSON(w, http.StatusOK, sourceObj)
	}
}

func UpdateOvaSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var payload CreateOvaSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		sourceObj, err := clients.Dynamic.Resource(ovaSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get OvaSource: "+err.Error())
			return
		}
		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "OvaSource missing credentials secret name")
			return
		}

		if payload.Username != "" || payload.Password != "" {
			secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
				return
			}

			if secret.StringData == nil {
				secret.StringData = make(map[string]string)
			}

			if payload.Username != "" {
				secret.StringData["username"] = payload.Username
			}
			if payload.Password != "" {
				secret.StringData["password"] = payload.Password
			}
			_, err = clients.Clientset.CoreV1().Secrets(namespace).Update(context.TODO(), secret, metav1.UpdateOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to update secret: "+err.Error())
				return
			}
		}

		if err := unstructured.SetNestedField(sourceObj.Object, payload.URL, "spec", "url"); err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to set URL: "+err.Error())
			return
		}
		if payload.HttpTimeoutSeconds > 0 {
			if err := unstructured.SetNestedField(sourceObj.Object, int64(payload.HttpTimeoutSeconds), "spec", "httpTimeoutSeconds"); err != nil {
				log.Warnf("Failed to set httpTimeoutSeconds: %v", err)
			}
		} else {
			unstructured.RemoveNestedField(sourceObj.Object, "spec", "httpTimeoutSeconds")
		}

		updatedObj, err := clients.Dynamic.Resource(ovaSourceGVR).Namespace(namespace).Update(context.TODO(), sourceObj, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to update OvaSource: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedObj)
	}
}

func DeleteOvaSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		sourceObj, err := clients.Dynamic.Resource(ovaSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get OvaSource: "+err.Error())
			return
		}
		secretName, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")

		err = clients.Dynamic.Resource(ovaSourceGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete OvaSource: "+err.Error())
			return
		}

		if secretName != "" {
			err = clients.Clientset.CoreV1().Secrets(namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{})
			if err != nil {
				log.Warnf("Failed to delete associated secret %s/%s: %v", namespace, secretName, err)
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

type VirtualMachinePowerRequest struct {
	VMName    string `json:"vmName"`
	Operation string `json:"operation"` // "on", "off", "reset", "shutdown"
}

func HandleVMPowerOp(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var req VirtualMachinePowerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Power operation '%s' requested for VM %s via VmwareSource %s/%s", req.Operation, req.VMName, namespace, name)

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}

		endpoint, found := getNestedStringOrWarn(sourceObj.Object, "spec", "endpoint")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing spec.endpoint")
			return
		}
		datacenter, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "dc")
		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}
		secretNamespace, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "namespace")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret namespace")
			return
		}

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get credentials secret: "+err.Error())
			return
		}

		creds := VCenterCredentials{
			URL:        endpoint,
			Username:   string(secret.Data["username"]),
			Password:   string(secret.Data["password"]),
			Datacenter: datacenter,
		}

		if err := PowerOpVM(r.Context(), creds, req.VMName, req.Operation); err != nil {
			log.Errorf("Failed to perform power operation: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]string{"message": "Power operation successful"})
	}
}

type VirtualMachineRenameRequest struct {
	OldName string `json:"oldName"`
	NewName string `json:"newName"`
}

func HandleVMRename(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var req VirtualMachineRenameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Rename operation requested from '%s' to '%s' via VmwareSource %s/%s", req.OldName, req.NewName, namespace, name)

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}

		endpoint, found := getNestedStringOrWarn(sourceObj.Object, "spec", "endpoint")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing spec.endpoint")
			return
		}
		datacenter, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "dc")
		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}
		secretNamespace, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "namespace")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret namespace")
			return
		}

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get credentials secret: "+err.Error())
			return
		}

		creds := VCenterCredentials{
			URL:        endpoint,
			Username:   string(secret.Data["username"]),
			Password:   string(secret.Data["password"]),
			Datacenter: datacenter,
		}

		if err := RenameVM(r.Context(), creds, req.OldName, req.NewName); err != nil {
			log.Errorf("Failed to rename VM: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]string{"message": "Rename successful"})
	}
}

type UpdateVMMACRequest struct {
	VMName    string `json:"vmName"`
	DeviceKey int32  `json:"deviceKey"`
	NewMAC    string `json:"newMac"`
}

func HandleUpdateVMMAC(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var req UpdateVMMACRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("MAC address update requested for VM '%s' (device %d) to '%s' via VmwareSource %s/%s", req.VMName, req.DeviceKey, req.NewMAC, namespace, name)

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}

		endpoint, found := getNestedStringOrWarn(sourceObj.Object, "spec", "endpoint")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing spec.endpoint")
			return
		}
		datacenter, _ := getNestedStringOrWarn(sourceObj.Object, "spec", "dc")
		secretName, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret name")
			return
		}
		secretNamespace, found := getNestedStringOrWarn(sourceObj.Object, "spec", "credentials", "namespace")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "VmwareSource missing credentials secret namespace")
			return
		}

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get credentials secret: "+err.Error())
			return
		}

		creds := VCenterCredentials{
			URL:        endpoint,
			Username:   string(secret.Data["username"]),
			Password:   string(secret.Data["password"]),
			Datacenter: datacenter,
		}

		if err := UpdateVMNetworkMAC(r.Context(), creds, req.VMName, req.DeviceKey, req.NewMAC); err != nil {
			log.Errorf("Failed to update VM MAC: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]string{"message": "MAC address updated successfully"})
	}
}

// --- Forklift Handlers ---

// CheckForkliftAvailability checks if the Forklift "host" Provider exists
func CheckForkliftAvailability(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		namespace := r.URL.Query().Get("namespace")
		if namespace == "" {
			namespace = "forklift"
		}

		// Check if the "host" provider exists
		_, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), "host", metav1.GetOptions{})
		if err != nil {
			respondWithJSON(w, http.StatusOK, map[string]interface{}{
				"available":        false,
				"defaultNamespace": namespace,
				"message":          "Forklift host Provider not found in namespace " + namespace + ". Forklift features are unavailable.",
			})
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]interface{}{
			"available":        true,
			"defaultNamespace": namespace,
		})
	}
}

// ListForkliftProvidersHandler lists Forklift Provider CRs (vsphere type only)
func ListForkliftProvidersHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace("").List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list Forklift Providers: "+err.Error())
			return
		}

		// Optional type filter from query param
		typeFilter := r.URL.Query().Get("type")

		// Filter to source providers (vsphere + ova), exclude "host" and "openshift"
		var sourceProviders []unstructured.Unstructured
		for _, item := range list.Items {
			providerType, _ := getNestedStringOrWarn(item.Object, "spec", "type")
			if typeFilter != "" {
				// Exact type filter
				if providerType == typeFilter {
					sourceProviders = append(sourceProviders, item)
				}
			} else {
				// Include all source providers
				if providerType == "vsphere" || providerType == "ova" {
					sourceProviders = append(sourceProviders, item)
				}
			}
		}
		respondWithJSON(w, http.StatusOK, sourceProviders)
	}
}

// CreateForkliftProviderHandler creates a Forklift Provider with its associated Secret
func CreateForkliftProviderHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload CreateForkliftProviderPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		if payload.Namespace == "" {
			payload.Namespace = "forklift"
		}

		// Default provider type to vsphere
		providerType := payload.ProviderType
		if providerType == "" {
			providerType = "vsphere"
		}

		// 1. Create the Opaque Secret with Forklift's expected format
		secretName := payload.Name + "-secret"
		var secretData map[string]string
		if providerType == "ova" {
			// OVA providers only need the NFS URL
			secretData = map[string]string{
				"url": payload.URL,
			}
		} else {
			// vSphere providers need credentials
			secretData = map[string]string{
				"user":               payload.Username,
				"password":           payload.Password,
				"url":                payload.URL,
				"insecureSkipVerify": "true",
			}
		}

		secret := &v1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: payload.Namespace,
				Labels: map[string]string{
					"createdForProviderType": providerType,
					"createdForResourceType": "providers",
				},
			},
			Type: v1.SecretTypeOpaque,
			StringData: secretData,
		}
		_, err := clients.Clientset.CoreV1().Secrets(payload.Namespace).Create(context.TODO(), secret, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift secret: "+err.Error())
			return
		}

		// 2. Create the Forklift Provider CR
		providerSpec := map[string]interface{}{
			"type": providerType,
			"url":  payload.URL,
			"secret": map[string]interface{}{
				"name":      secretName,
				"namespace": payload.Namespace,
			},
		}

		// vSphere providers need sdkEndpoint settings; OVA providers have no settings
		if providerType == "vsphere" {
			providerSpec["settings"] = map[string]interface{}{
				"sdkEndpoint": func() string {
					if payload.SdkEndpoint == "esxi" {
						return "esxi"
					}
					return "vcenter"
				}(),
			}
		}

		provider := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "forklift.konveyor.io/v1beta1",
				"kind":       "Provider",
				"metadata": map[string]interface{}{
					"name":      payload.Name,
					"namespace": payload.Namespace,
					"annotations": map[string]interface{}{
						"forklift.konveyor.io/empty-vddk-init-image": "yes",
					},
				},
				"spec": providerSpec,
			},
		}

		createdObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(payload.Namespace).Create(context.TODO(), provider, metav1.CreateOptions{})
		if err != nil {
			// Clean up secret on failure
			if cleanupErr := clients.Clientset.CoreV1().Secrets(payload.Namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete secret %s/%s: %v", payload.Namespace, secretName, cleanupErr)
			}
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift Provider: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

// GetForkliftProviderDetails returns a single Forklift Provider with its secret info
func GetForkliftProviderDetails(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		providerObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get Forklift Provider: "+err.Error())
			return
		}

		// Enrich with username from secret
		secretName, _ := getNestedStringOrWarn(providerObj.Object, "spec", "secret", "name")
		if secretName != "" {
			secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
			if err == nil {
				providerObj.Object["spec"].(map[string]interface{})["username"] = string(secret.Data["user"])
			}
		}

		respondWithJSON(w, http.StatusOK, providerObj)
	}
}

// UpdateForkliftProviderHandler updates a Forklift Provider and its Secret
func UpdateForkliftProviderHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var payload CreateForkliftProviderPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		providerObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get Forklift Provider: "+err.Error())
			return
		}

		// Update secret if credentials provided
		secretName, found := getNestedStringOrWarn(providerObj.Object, "spec", "secret", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "Forklift Provider missing secret name")
			return
		}
		if payload.Username != "" || payload.Password != "" {
			secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
				return
			}

			if secret.StringData == nil {
				secret.StringData = make(map[string]string)
			}
			if payload.Username != "" {
				secret.StringData["user"] = payload.Username
			}
			if payload.Password != "" {
				secret.StringData["password"] = payload.Password
			}
			if payload.URL != "" {
				secret.StringData["url"] = payload.URL
			}
			_, err = clients.Clientset.CoreV1().Secrets(namespace).Update(context.TODO(), secret, metav1.UpdateOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to update secret: "+err.Error())
				return
			}
		}

		// Update the Provider URL
		if payload.URL != "" {
			if err := unstructured.SetNestedField(providerObj.Object, payload.URL, "spec", "url"); err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to set URL: "+err.Error())
				return
			}
		}

		// Update sdkEndpoint setting
		if payload.SdkEndpoint != "" {
			if err := unstructured.SetNestedField(providerObj.Object, payload.SdkEndpoint, "spec", "settings", "sdkEndpoint"); err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to set sdkEndpoint: "+err.Error())
				return
			}
		}

		updatedObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Update(context.TODO(), providerObj, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to update Forklift Provider: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedObj)
	}
}

// DeleteForkliftProviderHandler deletes a Forklift Provider and its associated Secret
func DeleteForkliftProviderHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		providerObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get Forklift Provider: "+err.Error())
			return
		}
		secretName, _ := getNestedStringOrWarn(providerObj.Object, "spec", "secret", "name")

		err = clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete Forklift Provider: "+err.Error())
			return
		}

		if secretName != "" {
			err = clients.Clientset.CoreV1().Secrets(namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{})
			if err != nil {
				log.Warnf("Failed to delete associated Forklift secret %s/%s: %v", namespace, secretName, err)
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// HandleGetForkliftInventory fetches vCenter inventory using Forklift Provider credentials
func HandleGetForkliftInventory(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching inventory for Forklift Provider %s/%s", namespace, name)

		providerObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get Forklift Provider: "+err.Error())
			return
		}

		providerURL, found := getNestedStringOrWarn(providerObj.Object, "spec", "url")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "Forklift Provider missing URL")
			return
		}
		secretName, found := getNestedStringOrWarn(providerObj.Object, "spec", "secret", "name")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "Forklift Provider missing secret name")
			return
		}
		secretNamespace, found := getNestedStringOrWarn(providerObj.Object, "spec", "secret", "namespace")
		if !found {
			respondWithError(w, http.StatusInternalServerError, "Forklift Provider missing secret namespace")
			return
		}

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get Forklift credentials secret: "+err.Error())
			return
		}

		// Forklift secrets use "user" and "password" fields, and "url"
		// The URL from the secret or Provider spec both work; use Provider spec URL
		// Pass the full URL including /sdk path, same as VM Import Controller
		creds := VCenterCredentials{
			URL:        providerURL,
			Username:   string(secret.Data["user"]),
			Password:   string(secret.Data["password"]),
			Datacenter: "", // Will be auto-discovered
		}

		inventory, err := GetVCenterInventoryAutoDiscover(r.Context(), creds)
		if err != nil {
			log.Errorf("Failed to get vCenter inventory via Forklift Provider: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, inventory)
	}
}

// ListForkliftPlansHandler lists Forklift Plan CRs
func ListForkliftPlansHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(forkliftPlanGVR).Namespace("").List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list Forklift Plans: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

// CreateForkliftPlanHandler creates NetworkMap, StorageMap, and Plan atomically
func CreateForkliftPlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload CreateForkliftPlanPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		if payload.Namespace == "" {
			payload.Namespace = "forklift"
		}

		// Determine the namespace where Forklift's "host" provider lives
		hostProviderNs := payload.HostProviderNamespace
		if hostProviderNs == "" {
			hostProviderNs = "forklift"
		}

		log.Infof("Creating Forklift migration plan: %s in namespace %s", payload.Name, payload.Namespace)

		// 1. Create NetworkMap
		networkMapName := payload.Name + "-network-map"
		networkMapEntries := make([]interface{}, len(payload.NetworkMappings))
		for i, nm := range payload.NetworkMappings {
			dest := map[string]interface{}{
				"type": nm.DestinationType,
			}
			if nm.DestinationType == "multus" && nm.DestinationName != "" {
				dest["name"] = nm.DestinationName
				dest["namespace"] = nm.DestinationNamespace
			}
			source := map[string]interface{}{
				"id": nm.SourceID,
			}
			if nm.SourceName != "" {
				source["name"] = nm.SourceName
			}
			networkMapEntries[i] = map[string]interface{}{
				"source":      source,
				"destination": dest,
			}
		}

		networkMap := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "forklift.konveyor.io/v1beta1",
				"kind":       "NetworkMap",
				"metadata": map[string]interface{}{
					"name":      networkMapName,
					"namespace": payload.Namespace,
				},
				"spec": map[string]interface{}{
					"map": networkMapEntries,
					"provider": map[string]interface{}{
						"source": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       payload.ProviderName,
							"namespace":  payload.ProviderNamespace,
						},
						"destination": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       "host",
							"namespace":  hostProviderNs,
						},
					},
				},
			},
		}

		_, err := clients.Dynamic.Resource(forkliftNetworkMapGVR).Namespace(payload.Namespace).Create(context.TODO(), networkMap, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift NetworkMap: "+err.Error())
			return
		}

		// Determine provider type for plan creation logic
		providerType := payload.ProviderType
		if providerType == "" {
			providerType = "vsphere"
		}

		// 2. Create StorageMap
		storageMapName := payload.Name + "-storage-map"
		storageMapEntries := make([]interface{}, len(payload.StorageMappings))
		for i, sm := range payload.StorageMappings {
			dest := map[string]interface{}{
				"storageClass": sm.DestinationStorageClass,
			}
			if sm.VolumeMode != "" {
				dest["volumeMode"] = sm.VolumeMode
			}
			if sm.AccessMode != "" {
				dest["accessMode"] = sm.AccessMode
			}
			// OVA providers use source.name (disk filename), vSphere uses source.id (moRef)
			source := map[string]interface{}{}
			if providerType == "ova" && sm.SourceName != "" {
				source["name"] = sm.SourceName
			} else {
				source["id"] = sm.SourceID
			}
			storageMapEntries[i] = map[string]interface{}{
				"source":      source,
				"destination": dest,
			}
		}

		storageMap := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "forklift.konveyor.io/v1beta1",
				"kind":       "StorageMap",
				"metadata": map[string]interface{}{
					"name":      storageMapName,
					"namespace": payload.Namespace,
				},
				"spec": map[string]interface{}{
					"map": storageMapEntries,
					"provider": map[string]interface{}{
						"source": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       payload.ProviderName,
							"namespace":  payload.ProviderNamespace,
						},
						"destination": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       "host",
							"namespace":  hostProviderNs,
						},
					},
				},
			},
		}

		_, err = clients.Dynamic.Resource(forkliftStorageMapGVR).Namespace(payload.Namespace).Create(context.TODO(), storageMap, metav1.CreateOptions{})
		if err != nil {
			// Cleanup NetworkMap
			if cleanupErr := clients.Dynamic.Resource(forkliftNetworkMapGVR).Namespace(payload.Namespace).Delete(context.TODO(), networkMapName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete NetworkMap %s/%s: %v", payload.Namespace, networkMapName, cleanupErr)
			}
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift StorageMap: "+err.Error())
			return
		}

		// 3. Create Plan
		vmEntries := make([]interface{}, len(payload.VMs))
		for i, vm := range payload.VMs {
			entry := map[string]interface{}{
				"id":   vm.ID,
				"name": vm.Name,
			}
			if vm.TargetName != "" {
				entry["targetName"] = vm.TargetName
			}
			vmEntries[i] = entry
		}

		planAnnotations := map[string]interface{}{}
		if payload.PopulatorLabels {
			planAnnotations["populatorLabels"] = "True"
		}
		// Store source VM characteristics as annotations (same pattern as VMIC)
		if payload.SourceVmCpu > 0 {
			planAnnotations["migration.harvesterhci.io/original-cpu"] = fmt.Sprintf("%d", payload.SourceVmCpu)
		}
		if payload.SourceVmMemoryMB > 0 {
			planAnnotations["migration.harvesterhci.io/original-memory-mb"] = fmt.Sprintf("%d", payload.SourceVmMemoryMB)
		}
		if payload.SourceVmDiskSizeGB > 0 {
			planAnnotations["migration.harvesterhci.io/original-disk-size-gb"] = fmt.Sprintf("%d", payload.SourceVmDiskSizeGB)
		}
		if payload.SourceVmDisks != "" {
			planAnnotations["migration.harvesterhci.io/original-disks"] = payload.SourceVmDisks
		}
		if payload.SourceVmNetworks != "" {
			planAnnotations["migration.harvesterhci.io/original-networks"] = payload.SourceVmNetworks
		}
		if payload.DefaultNetworkInterfaceModel != "" {
			planAnnotations["migration.harvesterhci.io/default-nic-model"] = payload.DefaultNetworkInterfaceModel
		}

		plan := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "forklift.konveyor.io/v1beta1",
				"kind":       "Plan",
				"metadata": map[string]interface{}{
					"name":        payload.Name,
					"namespace":   payload.Namespace,
					"annotations": planAnnotations,
				},
				"spec": map[string]interface{}{
					"map": map[string]interface{}{
						"network": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "NetworkMap",
							"name":       networkMapName,
							"namespace":  payload.Namespace,
						},
						"storage": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "StorageMap",
							"name":       storageMapName,
							"namespace":  payload.Namespace,
						},
					},
					"provider": map[string]interface{}{
						"source": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       payload.ProviderName,
							"namespace":  payload.ProviderNamespace,
						},
						"destination": map[string]interface{}{
							"apiVersion": "forklift.konveyor.io/v1beta1",
							"kind":       "Provider",
							"name":       "host",
							"namespace":  hostProviderNs,
						},
					},
					"targetNamespace": payload.TargetNamespace,
					"warm": func() bool {
						if providerType == "ova" {
							return false
						}
						return payload.Warm
					}(),
					"migrateSharedDisks": payload.MigrateSharedDisks,
					"vms":                vmEntries,
				},
			},
		}

		createdPlan, err := clients.Dynamic.Resource(forkliftPlanGVR).Namespace(payload.Namespace).Create(context.TODO(), plan, metav1.CreateOptions{})
		if err != nil {
			// Cleanup NetworkMap and StorageMap
			if cleanupErr := clients.Dynamic.Resource(forkliftNetworkMapGVR).Namespace(payload.Namespace).Delete(context.TODO(), networkMapName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete NetworkMap %s/%s: %v", payload.Namespace, networkMapName, cleanupErr)
			}
			if cleanupErr := clients.Dynamic.Resource(forkliftStorageMapGVR).Namespace(payload.Namespace).Delete(context.TODO(), storageMapName, metav1.DeleteOptions{}); cleanupErr != nil {
				log.Warnf("Best-effort cleanup: failed to delete StorageMap %s/%s: %v", payload.Namespace, storageMapName, cleanupErr)
			}
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift Plan: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdPlan)
	}
}

// DeleteForkliftPlanHandler deletes a Forklift Plan and its associated NetworkMap/StorageMap
func DeleteForkliftPlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		// Get the plan to find associated maps
		planObj, err := clients.Dynamic.Resource(forkliftPlanGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get Forklift Plan: "+err.Error())
			return
		}

		networkMapName, _ := getNestedStringOrWarn(planObj.Object, "spec", "map", "network", "name")
		storageMapName, _ := getNestedStringOrWarn(planObj.Object, "spec", "map", "storage", "name")

		// Delete the Plan
		err = clients.Dynamic.Resource(forkliftPlanGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete Forklift Plan: "+err.Error())
			return
		}

		// Cleanup NetworkMap and StorageMap (best-effort)
		if networkMapName != "" {
			if delErr := clients.Dynamic.Resource(forkliftNetworkMapGVR).Namespace(namespace).Delete(context.TODO(), networkMapName, metav1.DeleteOptions{}); delErr != nil {
				log.Warnf("Failed to delete associated NetworkMap %s/%s: %v", namespace, networkMapName, delErr)
			}
		}
		if storageMapName != "" {
			if delErr := clients.Dynamic.Resource(forkliftStorageMapGVR).Namespace(namespace).Delete(context.TODO(), storageMapName, metav1.DeleteOptions{}); delErr != nil {
				log.Warnf("Failed to delete associated StorageMap %s/%s: %v", namespace, storageMapName, delErr)
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// HandleGetForkliftPlanYAML returns the YAML representation of a Forklift Plan
func HandleGetForkliftPlanYAML(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		item, err := clients.Dynamic.Resource(forkliftPlanGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		yamlBytes, err := yaml.Marshal(item.Object)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to marshal Forklift Plan to YAML: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/yaml")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(yamlBytes); err != nil {
			log.Warnf("Failed to write response: %v", err)
		}
	}
}

// HandleGetForkliftOvaInventory proxies inventory requests for OVA providers through the
// forklift-inventory service. OVA providers auto-deploy an OVA server pod that scans
// NFS shares for OVF/OVA files. The inventory service exposes VMs, networks, and disks.
func HandleGetForkliftOvaInventory(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]
		// resource can be "vms", "networks", or "disks"
		resource := vars["resource"]
		if resource == "" {
			resource = "vms"
		}

		// 1. Get the Provider CR to obtain its UID
		providerObj, err := clients.Dynamic.Resource(forkliftProviderGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get OVA provider: "+err.Error())
			return
		}
		providerUID := string(providerObj.GetUID())

		// 2. Discover the forklift-inventory service
		// The inventory service runs in the same namespace as the Forklift operator
		forkliftNs := namespace
		svc, err := clients.Clientset.CoreV1().Services(forkliftNs).Get(context.TODO(), "forklift-inventory", metav1.GetOptions{})
		if err != nil {
			// Try the default forklift namespace
			forkliftNs = "forklift"
			svc, err = clients.Clientset.CoreV1().Services(forkliftNs).Get(context.TODO(), "forklift-inventory", metav1.GetOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Cannot find forklift-inventory service: "+err.Error())
				return
			}
		}

		// 3. Build the inventory URL
		// The inventory service typically listens on port 8443
		port := "8443"
		for _, p := range svc.Spec.Ports {
			if p.Name == "api" || p.Name == "https" {
				port = fmt.Sprintf("%d", p.Port)
				break
			}
		}
		inventoryURL := fmt.Sprintf("http://forklift-inventory.%s.svc:%s/providers/ova/%s/%s",
			forkliftNs, port, providerUID, resource)

		log.Debugf("Proxying OVA inventory request to: %s", inventoryURL)

		// 4. Proxy the request
		resp, err := http.Get(inventoryURL)
		if err != nil {
			respondWithError(w, http.StatusBadGateway, "Failed to reach forklift-inventory: "+err.Error())
			return
		}
		defer resp.Body.Close()

		// Copy response headers and status
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		if _, copyErr := io.Copy(w, resp.Body); copyErr != nil {
			log.Warnf("Failed to proxy OVA inventory response: %v", copyErr)
		}
	}
}

// HandleGetForkliftLogs fetches logs from Forklift controller pods and migration worker pods.
// Forklift labels worker pods with "plan-name" = <planName> and "forklift.app" = virt-v2v | consumer | virt-v2v-inspection.
// Worker pods run in the plan's targetNamespace; hooks run in the plan namespace.
// Controller pods use structured JSON logging with "plan", "migration", "vm" fields.
func HandleGetForkliftLogs(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		planNamespace := vars["namespace"]
		planName := vars["name"]

		forkliftNs := r.URL.Query().Get("forkliftNamespace")
		if forkliftNs == "" {
			forkliftNs = planNamespace
		}
		showAll := r.URL.Query().Get("all") == "true"
		errorsOnly := r.URL.Query().Get("errors") == "true"

		log.Debugf("Fetching Forklift logs for plan %s/%s (forklift ns: %s)", planNamespace, planName, forkliftNs)

		// Get the plan to find target namespace and VM IDs/names
		var targetNamespace string
		var vmIDs []string
		planObj, err := clients.Dynamic.Resource(forkliftPlanGVR).Namespace(planNamespace).Get(context.TODO(), planName, metav1.GetOptions{})
		if err == nil {
			targetNamespace, _ = getNestedStringOrWarn(planObj.Object, "spec", "targetNamespace")
			vms, _, vmsErr := unstructured.NestedSlice(planObj.Object, "spec", "vms")
			if vmsErr != nil {
				log.Warnf("Error reading spec.vms: %v", vmsErr)
			}
			for _, vm := range vms {
				if vmMap, ok := vm.(map[string]interface{}); ok {
					if id, ok := vmMap["id"].(string); ok && id != "" {
						vmIDs = append(vmIDs, id)
					}
				}
			}
		}

		// Related resource names that appear in controller logs
		migrationName := planName + "-migration"
		networkMapName := planName + "-network-map"
		storageMapName := planName + "-storage-map"
		controllerMatchTerms := []string{planName, migrationName, networkMapName, storageMapName}

		var logOutput strings.Builder

		isErrorLine := func(line string) bool {
			l := strings.ToLower(line)
			return strings.Contains(l, "error") || strings.Contains(l, "fail") ||
				strings.Contains(l, "warn") || strings.Contains(l, "critical") ||
				strings.Contains(l, "\"level\":\"error\"") || strings.Contains(l, "\"level\":\"warn\"")
		}

		// fetchAndWriteLogs streams logs from a pod/container, optionally filtering.
		// If filterTerms is nil, all lines are included (worker pods are already plan-specific).
		fetchAndWriteLogs := func(ns string, pod v1.Pod, filterTerms []string, header string) {
			for _, cs := range append(pod.Spec.InitContainers, pod.Spec.Containers...) {
				req := clients.Clientset.CoreV1().Pods(ns).GetLogs(pod.Name, &v1.PodLogOptions{
					Container: cs.Name,
				})
				stream, err := req.Stream(context.TODO())
				if err != nil {
					// Skip containers that can't be read (not started, etc.)
					continue
				}

				headerWritten := false
				scanner := bufio.NewScanner(stream)
				buf := make([]byte, 0, 64*1024)
				scanner.Buffer(buf, 1024*1024)

				for scanner.Scan() {
					line := scanner.Text()
					include := showAll

					if !include && filterTerms != nil {
						// Controller pod: only include lines mentioning our plan/resources
						for _, term := range filterTerms {
							if strings.Contains(line, term) {
								include = true
								break
							}
						}
					} else if filterTerms == nil {
						// Worker pod: include everything
						include = true
					}

					if include && errorsOnly && !showAll {
						include = isErrorLine(line)
					}

					if include {
						if !headerWritten && header != "" {
							logOutput.WriteString(header)
							headerWritten = true
						}
						logOutput.WriteString(line + "\n")
					}
				}
				stream.Close()
			}
		}

		// ── 1. Forklift controller pod (filtered by plan name) ──
		// The controller pod is labeled app=forklift-controller in the forklift namespace
		controllerPods, _ := clients.Clientset.CoreV1().Pods(forkliftNs).List(context.TODO(), metav1.ListOptions{
			LabelSelector: "app=forklift-controller",
		})
		if controllerPods == nil || len(controllerPods.Items) == 0 {
			// Fallback: any pod with "forklift-controller" in the name
			allPods, _ := clients.Clientset.CoreV1().Pods(forkliftNs).List(context.TODO(), metav1.ListOptions{})
			if allPods != nil {
				for _, p := range allPods.Items {
					if strings.Contains(p.Name, "forklift-controller") {
						if controllerPods == nil {
							controllerPods = &v1.PodList{}
						}
						controllerPods.Items = append(controllerPods.Items, p)
					}
				}
			}
		}
		if controllerPods != nil {
			for _, pod := range controllerPods.Items {
				fetchAndWriteLogs(forkliftNs, pod, controllerMatchTerms,
					fmt.Sprintf("\n=== Forklift Controller: %s ===\n", pod.Name))
			}
		}

		// ── 2. Migration worker pods (label: plan-name=<planName>) ──
		// These run in targetNamespace and include virt-v2v, virt-v2v-inspection, consumer pods.
		// Forklift labels them with plan-name=<planName>.
		searchNamespaces := []string{}
		if targetNamespace != "" {
			searchNamespaces = append(searchNamespaces, targetNamespace)
		}
		if planNamespace != targetNamespace {
			searchNamespaces = append(searchNamespaces, planNamespace)
		}

		for _, ns := range searchNamespaces {
			// Direct label query — most efficient
			workerPods, err := clients.Clientset.CoreV1().Pods(ns).List(context.TODO(), metav1.ListOptions{
				LabelSelector: "plan-name=" + planName,
			})
			if err == nil {
				for _, pod := range workerPods.Items {
					appLabel := pod.Labels["forklift.app"]
					podType := "Worker"
					switch appLabel {
					case "virt-v2v":
						podType = "virt-v2v Conversion"
					case "virt-v2v-inspection":
						podType = "virt-v2v Inspection"
					case "consumer":
						podType = "Consumer"
					}
					vmID := pod.Labels["vmID"]
					vmInfo := ""
					if vmID != "" {
						vmInfo = fmt.Sprintf(" (VM: %s)", vmID)
					}
					fetchAndWriteLogs(ns, pod, nil,
						fmt.Sprintf("\n=== %s: %s/%s%s ===\n", podType, ns, pod.Name, vmInfo))
				}
			}

			// Also look for populator pods (created by CDI, name prefix "populate-")
			// and pods whose name starts with the plan name (hook jobs, converter jobs)
			allPods, err := clients.Clientset.CoreV1().Pods(ns).List(context.TODO(), metav1.ListOptions{})
			if err == nil {
				seen := map[string]bool{}
				if workerPods != nil {
					for _, p := range workerPods.Items {
						seen[p.Name] = true
					}
				}
				for _, pod := range allPods.Items {
					if seen[pod.Name] {
						continue
					}
					isRelevant := false
					podType := "Related Pod"

					// Check if pod name starts with planName (hook jobs, converter jobs)
					if strings.HasPrefix(pod.Name, planName+"-") {
						isRelevant = true
						podType = "Plan Pod"
					}

					// Check for populator pods by looking at migration label
					if !isRelevant && strings.HasPrefix(pod.Name, "populate-") {
						if _, hasMigLabel := pod.Labels["migration"]; hasMigLabel {
							// Check if this populator's migration label matches our plan's migration
							isRelevant = true
							podType = "CDI Populator"
						}
					}

					// Check for converter jobs
					if !isRelevant && strings.HasPrefix(pod.Name, "convert-") {
						for _, vmID := range vmIDs {
							if strings.Contains(pod.Name, vmID) {
								isRelevant = true
								podType = "Disk Converter"
								break
							}
						}
					}

					if isRelevant {
						fetchAndWriteLogs(ns, pod, nil,
							fmt.Sprintf("\n=== %s: %s/%s ===\n", podType, ns, pod.Name))
					}
				}
			}
		}

		if logOutput.Len() == 0 {
			logOutput.WriteString(fmt.Sprintf("No matching log entries found for plan '%s'.\n\n", planName))
			logOutput.WriteString("Troubleshooting tips:\n")
			logOutput.WriteString("  1. Disable 'Only relevant' to see all Forklift controller logs\n")
			if targetNamespace != "" {
				logOutput.WriteString(fmt.Sprintf("  2. Check worker pods: kubectl get pods -n %s -l plan-name=%s\n", targetNamespace, planName))
				logOutput.WriteString(fmt.Sprintf("  3. Check populator pods: kubectl get pods -n %s | grep populate-\n", targetNamespace))
			}
			logOutput.WriteString(fmt.Sprintf("  4. Controller logs: kubectl logs -n %s -l app=forklift-controller | grep %s\n", forkliftNs, planName))
		}

		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(logOutput.String())); err != nil {
			log.Warnf("Failed to write response: %v", err)
		}
	}
}

// CreateForkliftMigrationHandler creates a Migration CR to start executing a Forklift Plan
func CreateForkliftMigrationHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Creating Migration for Forklift Plan %s/%s", namespace, name)

		migration := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "forklift.konveyor.io/v1beta1",
				"kind":       "Migration",
				"metadata": map[string]interface{}{
					"name":      name + "-migration",
					"namespace": namespace,
				},
				"spec": map[string]interface{}{
					"plan": map[string]interface{}{
						"name":      name,
						"namespace": namespace,
					},
				},
			},
		}

		createdObj, err := clients.Dynamic.Resource(forkliftMigrationGVR).Namespace(namespace).Create(context.TODO(), migration, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create Forklift Migration: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

// DeleteForkliftMigrationHandler deletes an existing Migration CR for a Plan
func DeleteForkliftMigrationHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		migrationName := name + "-migration"
		log.Infof("Deleting Forklift Migration %s/%s", namespace, migrationName)

		err := clients.Dynamic.Resource(forkliftMigrationGVR).Namespace(namespace).Delete(context.TODO(), migrationName, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete Forklift Migration: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]string{"message": "Migration deleted"})
	}
}

// GetForkliftMigrationStatus returns the status of Migrations for a Plan
func GetForkliftMigrationStatus(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		// List all migrations in the namespace
		list, err := clients.Dynamic.Resource(forkliftMigrationGVR).Namespace(namespace).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list Forklift Migrations: "+err.Error())
			return
		}

		// Find the migration for this plan (prefer the most recent one)
		var latestMigration map[string]interface{}
		var latestTime string
		for _, item := range list.Items {
			planName, _ := getNestedStringOrWarn(item.Object, "spec", "plan", "name")
			if planName == name {
				created := item.GetCreationTimestamp().Format("2006-01-02T15:04:05Z")
				if created > latestTime {
					latestTime = created
					obj := item.Object
					latestMigration = obj
				}
			}
		}
		if latestMigration != nil {
			respondWithJSON(w, http.StatusOK, latestMigration)
			return
		}

		respondWithJSON(w, http.StatusOK, map[string]interface{}{"message": "No migration found for this plan"})
	}
}

