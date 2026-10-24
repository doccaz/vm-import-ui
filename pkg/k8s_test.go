// pkg/k8s_test.go
package main

import (
	"testing"

	"k8s.io/client-go/rest"
)

func TestTLSIsVerifiedByDefault(t *testing.T) {
	cfg := &rest.Config{TLSClientConfig: rest.TLSClientConfig{CAData: []byte("ca")}}
	applyTLSPolicy(cfg)
	if cfg.TLSClientConfig.Insecure || string(cfg.TLSClientConfig.CAData) != "ca" {
		t.Fatalf("default must keep verification and the CA: %+v", cfg.TLSClientConfig)
	}
}

func TestTLSOptOutIsExplicit(t *testing.T) {
	t.Setenv("INSECURE_SKIP_TLS_VERIFY", "true")
	cfg := &rest.Config{TLSClientConfig: rest.TLSClientConfig{CAData: []byte("ca"), CAFile: "/ca"}}
	applyTLSPolicy(cfg)
	if !cfg.TLSClientConfig.Insecure || cfg.TLSClientConfig.CAData != nil || cfg.TLSClientConfig.CAFile != "" {
		t.Fatalf("opt-out must disable verification and clear the CA: %+v", cfg.TLSClientConfig)
	}
	t.Setenv("INSECURE_SKIP_TLS_VERIFY", "false")
	cfg = &rest.Config{}
	applyTLSPolicy(cfg)
	if cfg.TLSClientConfig.Insecure {
		t.Fatal("only the exact value \"true\" opts out")
	}
}
