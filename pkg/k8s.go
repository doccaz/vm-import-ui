package main

import (
	"os"
	"path/filepath"

	log "github.com/sirupsen/logrus"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// NewK8sClient creates a new Kubernetes clientset.
// It uses in-cluster config if running inside a pod, otherwise it falls back
// to the local kubeconfig file for local development.
func NewK8sClient() (*kubernetes.Clientset, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		log.Warnf("Could not load in-cluster config: %v. Falling back to kubeconfig.", err)

		// Fallback to kubeconfig for local development
		var kubeconfig string
		if kcEnv, ok := os.LookupEnv("KUBECONFIG"); ok {
			kubeconfig = kcEnv
		} else if home := os.Getenv("HOME"); home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		} else {
			// Fallback for cases where HOME is not set
			return nil, err
		}

		log.Infof("Using out-of-cluster config with kubeconfig from %s", kubeconfig)
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, err
		}
	} else {
		log.Info("Using in-cluster config.")
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}
	return clientset, nil
}
