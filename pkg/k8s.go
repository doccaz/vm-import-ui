package main

import (
	"os"
	"path/filepath"

	log "github.com/sirupsen/logrus"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type K8sClients struct {
	Clientset *kubernetes.Clientset
	Dynamic   dynamic.Interface
}

func NewK8sClients() (*K8sClients, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		log.Warnf("Could not load in-cluster config: %v. Falling back to kubeconfig.", err)

		var kubeconfig string
		if kcEnv, ok := os.LookupEnv("KUBECONFIG"); ok {
			kubeconfig = kcEnv
		} else if home := os.Getenv("HOME"); home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		} else {
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

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &K8sClients{
		Clientset: clientset,
		Dynamic:   dynamicClient,
	}, nil
}
