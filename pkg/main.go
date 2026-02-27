// pkg/main.go
package main

import (
	"net/http"
	"os"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
)

func main() {
	log.SetFormatter(&log.JSONFormatter{})

	logLevel, err := log.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		logLevel = log.InfoLevel
	}
	log.SetLevel(logLevel)

	log.Info("Starting VM Import UI Backend v1.1.0")

	k8sClients, err := NewK8sClients()
	if err != nil && os.Getenv("USE_MOCK_DATA") != "true" {
		log.Fatalf("Failed to create Kubernetes clients: %v", err)
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()

	// API Handlers
	api.HandleFunc("/capabilities", GetCapabilitiesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/vcenter/inventory/{namespace}/{name}", HandleGetInventory(k8sClients)).Methods("GET")
	api.HandleFunc("/plans", CreatePlanHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/plans", ListPlansHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/plans/{namespace}/{name}", DeletePlanHandler(k8sClients)).Methods("DELETE")
	api.HandleFunc("/plans/{namespace}/{name}/run", RunPlanHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/plans/{namespace}/{name}/logs", HandleGetPlanLogs(k8sClients)).Methods("GET")
	api.HandleFunc("/plans/{namespace}/{name}/yaml", HandleGetPlanYAML(k8sClients)).Methods("GET")

	// Harvester Resource Handlers
	api.HandleFunc("/harvester/vmwaresources", ListVmwareSourcesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/vmwaresources", CreateVmwareSourceHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/harvester/vmwaresources/{namespace}/{name}", GetVmwareSourceDetails(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/vmwaresources/{namespace}/{name}", UpdateVmwareSourceHandler(k8sClients)).Methods("PUT")
	api.HandleFunc("/harvester/vmwaresources/{namespace}/{name}", DeleteVmwareSourceHandler(k8sClients)).Methods("DELETE")
	api.HandleFunc("/harvester/vmwaresources/{namespace}/{name}/yaml", HandleGetSourceYAML(k8sClients, vmwareSourceGVR)).Methods("GET")

	api.HandleFunc("/harvester/ovasources", ListOvaSourcesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/ovasources", CreateOvaSourceHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/harvester/ovasources/{namespace}/{name}", GetOvaSourceDetails(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/ovasources/{namespace}/{name}", UpdateOvaSourceHandler(k8sClients)).Methods("PUT")
	api.HandleFunc("/harvester/ovasources/{namespace}/{name}", DeleteOvaSourceHandler(k8sClients)).Methods("DELETE")
	api.HandleFunc("/harvester/ovasources/{namespace}/{name}/yaml", HandleGetSourceYAML(k8sClients, ovaSourceGVR)).Methods("GET")

	api.HandleFunc("/harvester/namespaces", ListNamespacesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/namespaces", CreateNamespaceHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/harvester/vlanconfigs", ListVlanConfigsHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/storageclasses", ListStorageClassesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/virtualmachines/{namespace}", ListVMsHandler(k8sClients)).Methods("GET")

	// Serve the frontend
	uiPath := "/ui"
	if p := os.Getenv("UI_PATH"); p != "" {
		uiPath = p
	}
	fs := http.FileServer(http.Dir(uiPath))
	router.PathPrefix("/").Handler(http.StripPrefix("/", fs))

	log.Info("Server is starting on port 8080")
	if err := http.ListenAndServe(":8080", router); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
