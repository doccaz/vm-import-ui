package main

import (
	"net/http"
	"os"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
)

func main() {
	log.SetFormatter(&log.JSONFormatter{})

	// Set log level from environment variable
	logLevel, err := log.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		logLevel = log.InfoLevel
	}
	log.SetLevel(logLevel)

	log.Info("Starting VM Import UI Backend v0.4.6")

	k8sClients, err := NewK8sClients()
	if err != nil && os.Getenv("USE_MOCK_DATA") != "true" {
		log.Fatalf("Failed to create Kubernetes clients: %v", err)
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()

	// API Handlers
	api.HandleFunc("/vcenter/connect", HandleVcenterConnect).Methods("POST")
	api.HandleFunc("/plans", CreatePlanHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/plans", ListPlansHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/plans/{id}", GetPlanHandler(k8sClients)).Methods("GET")

	// Harvester Resource Handlers
	api.HandleFunc("/harvester/namespaces", ListNamespacesHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/namespaces", CreateNamespaceHandler(k8sClients)).Methods("POST")
	api.HandleFunc("/harvester/vlanconfigs", ListVlanConfigsHandler(k8sClients)).Methods("GET")
	api.HandleFunc("/harvester/storageclasses", ListStorageClassesHandler(k8sClients)).Methods("GET")

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
