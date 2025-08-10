package main

import (
	"net/http"
	"os"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
)

func main() {
	log.SetFormatter(&log.JSONFormatter{})
	log.Info("Starting VM Import UI Backend v0.3.2")

	clientset, err := NewK8sClient()
	if err != nil {
		log.Fatalf("Failed to create Kubernetes client: %v", err)
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()

	// API Handlers
	api.HandleFunc("/vcenter/connect", HandleVcenterConnect).Methods("POST")
	api.HandleFunc("/plans", CreatePlanHandler(clientset)).Methods("POST")
	api.HandleFunc("/plans", ListPlansHandler(clientset)).Methods("GET")
	api.HandleFunc("/plans/{id}", GetPlanHandler(clientset)).Methods("GET")

	// Harvester Resource Handlers
	api.HandleFunc("/harvester/namespaces", ListNamespacesHandler(clientset)).Methods("GET")
	api.HandleFunc("/harvester/namespaces", CreateNamespaceHandler(clientset)).Methods("POST")
	api.HandleFunc("/harvester/vlanconfigs", ListVlanConfigsHandler(clientset)).Methods("GET")
	api.HandleFunc("/harvester/storageclasses", ListStorageClassesHandler(clientset)).Methods("GET")

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
