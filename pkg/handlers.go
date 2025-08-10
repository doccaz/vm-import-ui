package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type VCenterCredentials struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func HandleVcenterConnect(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("USE_MOCK_DATA") == "true" {
		log.Info("Using mock data for vCenter connection")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockVcenterInventory)
		return
	}

	var creds VCenterCredentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	inventory, err := GetVCenterInventory(r.Context(), creds)
	if err != nil {
		log.Errorf("Failed to get vCenter inventory: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(inventory)
}

func CreatePlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Creating VirtualMachineImport CR")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "plan submitted"})
	}
}

func ListPlansHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("USE_MOCK_DATA") == "true" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(mockPlans)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}
}

func GetPlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("USE_MOCK_DATA") == "true" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(mockPlanDetails)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{})
	}
}

func ListNamespacesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("USE_MOCK_DATA") == "true" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(mockNamespaces)
			return
		}
		namespaces, err := clients.Clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(namespaces.Items)
	}
}

func CreateNamespaceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		log.Infof("Creating namespace: %s", payload.Name)
		nsSpec := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: payload.Name}}
		_, err := clients.Clientset.CoreV1().Namespaces().Create(context.TODO(), nsSpec, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "namespace created"})
	}
}

func ListVlanConfigsHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("USE_MOCK_DATA") == "true" {
			log.Info("Using mock data for VLAN configs")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(mockHarvesterNetworks)
			return
		}

		log.Info("Listing Harvester VlanConfigs")
		gvr := schema.GroupVersionResource{
			Group:    "network.harvesterhci.io",
			Version:  "v1beta1",
			Resource: "vlanconfigs",
		}

		list, err := clients.Dynamic.Resource(gvr).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Debugf("Fetched VLAN configs: %+v", list.Items)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list.Items)
	}
}

func ListStorageClassesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scs, err := clients.Clientset.StorageV1().StorageClasses().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(scs.Items)
	}
}
