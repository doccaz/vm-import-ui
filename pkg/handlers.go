package main

import (
	"context"
	"encoding/json"
	"net/http"

	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func HandleVcenterConnect(w http.ResponseWriter, r *http.Request) {
	log.Info("Proxying request to vCenter")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mockVcenterInventory)
}

func CreatePlanHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Creating VirtualMachineImport CR")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "plan submitted"})
	}
}

func ListPlansHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Listing VirtualMachineImport CRs")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockPlans)
	}
}

func GetPlanHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Getting details for a VirtualMachineImport CR")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockPlanDetails)
	}
}

func ListNamespacesHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		namespaces, err := clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(namespaces.Items)
	}
}

func CreateNamespaceHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if payload.Name == "" {
			http.Error(w, "Namespace name cannot be empty", http.StatusBadRequest)
			return
		}

		log.Infof("Creating namespace: %s", payload.Name)
		nsSpec := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: payload.Name}}
		_, err := clientset.CoreV1().Namespaces().Create(context.TODO(), nsSpec, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "namespace created"})
	}
}

func ListVlanConfigsHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Listing Harvester VlanConfigs")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockHarvesterNetworks)
	}
}

func ListStorageClassesHandler(clientset *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scs, err := clientset.StorageV1().StorageClasses().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(scs.Items)
	}
}
