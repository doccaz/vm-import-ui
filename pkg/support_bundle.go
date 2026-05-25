// pkg/support_bundle.go
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	log "github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	appVersion                 = "1.7.2"
	supportBundleSchemaVersion = "1"
)

// supportBundle accumulates JSON files and best-effort gather errors, then
// serialises everything into one tar.gz. Every file is JSON so the bundle
// doubles as a drop-in fixture set for tests.
type supportBundle struct {
	root string
	tw   *tar.Writer
	errs map[string]string
}

func (b *supportBundle) addJSON(path string, obj interface{}) {
	data, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		b.errs[path] = err.Error()
		return
	}
	hdr := &tar.Header{
		Name:    b.root + "/" + path,
		Mode:    0o644,
		Size:    int64(len(data)),
		ModTime: time.Now(),
	}
	if err := b.tw.WriteHeader(hdr); err != nil {
		b.errs[path] = err.Error()
		return
	}
	if _, err := b.tw.Write(data); err != nil {
		b.errs[path] = err.Error()
	}
}

// step runs a gather func; any error (or panic) is recorded under name and
// never aborts the bundle. A partial bundle is far more useful than a 500, and
// optional subsystems (e.g. Forklift CRDs not installed) must not break it.
func (b *supportBundle) step(name string, fn func() error) {
	defer func() {
		if r := recover(); r != nil {
			b.errs[name] = fmt.Sprintf("panic: %v", r)
		}
	}()
	if err := fn(); err != nil {
		b.errs[name] = err.Error()
	}
}

// safeList lists a GVR cluster-wide, returning nil on error or panic (e.g. a
// CRD that isn't installed). Used for secret-reference discovery, where the
// underlying list errors are already surfaced by the matching dumpCRs step.
func safeList(ctx context.Context, clients *K8sClients, gvr schema.GroupVersionResource) (items []unstructured.Unstructured) {
	defer func() { _ = recover() }()
	list, err := clients.Dynamic.Resource(gvr).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil
	}
	return list.Items
}

// dumpCRs lists every object of a (namespaced) GVR cluster-wide and writes one
// JSON file per object. The full unstructured object is kept — including
// status.conditions and managedFields, both of which are load-bearing for
// diagnosing infra bugs (e.g. spotting a controller that set an invalid state).
func (b *supportBundle) dumpCRs(ctx context.Context, clients *K8sClients, dir string, gvr schema.GroupVersionResource) {
	b.step(dir, func() error {
		list, err := clients.Dynamic.Resource(gvr).Namespace("").List(ctx, metav1.ListOptions{})
		if err != nil {
			return err
		}
		for i := range list.Items {
			item := list.Items[i]
			name := item.GetName()
			if ns := item.GetNamespace(); ns != "" {
				name = ns + "_" + name
			}
			b.addJSON(fmt.Sprintf("%s/%s.json", dir, name), item.Object)
		}
		return nil
	})
}

// SupportBundleHandler gathers cluster context, migration CRs, redacted secret
// metadata, and (opt-in) vCenter inventory into a downloadable tar.gz.
//
// Query params:
//   - inventory=true   include vCenter inventory (slow/large; default off)
//   - source=ns/name   scope inventory to a single VmwareSource
//   - anonymize=true   hash identifying names in the inventory tree
func SupportBundleHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		includeInv := r.URL.Query().Get("inventory") == "true"
		anonymize := r.URL.Query().Get("anonymize") == "true"
		scopeSource := r.URL.Query().Get("source")

		ts := time.Now().UTC().Format("20060102T150405Z")

		// Assemble into a buffer so a failure before any write can still 500
		// cleanly, and per-file errors are captured rather than truncating output.
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		tw := tar.NewWriter(gz)
		b := &supportBundle{root: "vm-import-support-" + ts, tw: tw, errs: map[string]string{}}

		salt := newAnonSalt(anonymize)

		b.addJSON("meta.json", map[string]interface{}{
			"schemaVersion": supportBundleSchemaVersion,
			"appVersion":    appVersion,
			"timestamp":     time.Now().UTC().Format(time.RFC3339),
			"redaction": map[string]interface{}{
				"secretsStripped":     true,
				"inventoryAnonymized": anonymize,
				"crsAnonymized":       false,
			},
			"options": map[string]interface{}{
				"inventory": includeInv,
				"source":    scopeSource,
			},
		})

		// --- cluster context (feature gating + map targets) ---
		b.step("cluster/capabilities", func() error {
			caps, err := gatherCapabilities(ctx, clients)
			b.addJSON("cluster/capabilities.json", caps) // record even the fallback config
			return err
		})
		b.step("cluster/storageclasses", func() error {
			scs, err := clients.Clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
			if err != nil {
				return err
			}
			b.addJSON("cluster/storageclasses.json", scs.Items)
			return nil
		})
		b.step("cluster/namespaces", func() error {
			ns, err := clients.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
			if err != nil {
				return err
			}
			b.addJSON("cluster/namespaces.json", ns.Items)
			return nil
		})
		nadGVR := schema.GroupVersionResource{
			Group:    "k8s.cni.cncf.io",
			Version:  "v1",
			Resource: "network-attachment-definitions",
		}
		b.step("cluster/nads", func() error {
			nads, err := clients.Dynamic.Resource(nadGVR).Namespace("").List(ctx, metav1.ListOptions{})
			if err != nil {
				return err
			}
			b.addJSON("cluster/networkattachmentdefinitions.json", nads.Items)
			return nil
		})

		// --- raw CRs: inputs (sources/providers) and outputs (plans/maps/migrations) ---
		b.dumpCRs(ctx, clients, "sources/vmware", vmwareSourceGVR)
		b.dumpCRs(ctx, clients, "sources/ova", ovaSourceGVR)
		b.dumpCRs(ctx, clients, "providers", forkliftProviderGVR)
		b.dumpCRs(ctx, clients, "plans/vmic", vmiGVR)
		b.dumpCRs(ctx, clients, "plans/forklift", forkliftPlanGVR)
		b.dumpCRs(ctx, clients, "forklift/networkmaps", forkliftNetworkMapGVR)
		b.dumpCRs(ctx, clients, "forklift/storagemaps", forkliftStorageMapGVR)
		b.dumpCRs(ctx, clients, "forklift/migrations", forkliftMigrationGVR)

		// --- secrets: ONLY those referenced by sources/providers, metadata + key
		// NAMES only. We never list every cluster secret — that's noise and leaks
		// the names of unrelated secrets. Values never leave the cluster. ---
		b.step("secrets", func() error {
			type secretRef struct{ ns, name string }
			refs := map[string]secretRef{}
			addRef := func(ns, name string) {
				if name == "" {
					return
				}
				refs[ns+"/"+name] = secretRef{ns, name}
			}

			// VMIC sources reference credentials at spec.credentials.{name,namespace}.
			for _, gvr := range []schema.GroupVersionResource{vmwareSourceGVR, ovaSourceGVR} {
				for _, item := range safeList(ctx, clients, gvr) {
					name, _, _ := unstructured.NestedString(item.Object, "spec", "credentials", "name")
					ns, _, _ := unstructured.NestedString(item.Object, "spec", "credentials", "namespace")
					if ns == "" {
						ns = item.GetNamespace()
					}
					addRef(ns, name)
				}
			}
			// Forklift providers reference their secret at spec.secret.{name,namespace}.
			for _, item := range safeList(ctx, clients, forkliftProviderGVR) {
				name, _, _ := unstructured.NestedString(item.Object, "spec", "secret", "name")
				ns, _, _ := unstructured.NestedString(item.Object, "spec", "secret", "namespace")
				if ns == "" {
					ns = item.GetNamespace()
				}
				addRef(ns, name)
			}

			for _, r := range refs {
				secret, err := clients.Clientset.CoreV1().Secrets(r.ns).Get(ctx, r.name, metav1.GetOptions{})
				if err != nil {
					b.errs[fmt.Sprintf("secrets/%s_%s", r.ns, r.name)] = err.Error()
					continue
				}
				keys := make([]string, 0, len(secret.Data))
				for k := range secret.Data {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				b.addJSON(fmt.Sprintf("secrets/%s_%s.json", secret.Namespace, secret.Name), map[string]interface{}{
					"name":      secret.Name,
					"namespace": secret.Namespace,
					"type":      string(secret.Type),
					"dataKeys":  keys, // names only — values intentionally omitted
				})
			}
			return nil
		})

		// --- optional inventory (slow; per selected/all VmwareSource) ---
		if includeInv {
			b.step("inventory", func() error {
				list, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace("").List(ctx, metav1.ListOptions{})
				if err != nil {
					return err
				}
				for i := range list.Items {
					src := list.Items[i]
					ref := fmt.Sprintf("%s/%s", src.GetNamespace(), src.GetName())
					if scopeSource != "" && scopeSource != ref {
						continue
					}
					file := fmt.Sprintf("inventory/vmware_%s_%s.json", src.GetNamespace(), src.GetName())
					tree, ierr := gatherVCenterInventory(ctx, clients, src.GetNamespace(), src.GetName())
					if ierr != nil {
						b.errs[file] = ierr.Error()
						continue
					}
					if anonymize {
						anonymizeInventory(tree, salt)
					}
					b.addJSON(file, tree)
				}
				return nil
			})
		}

		b.addJSON("errors.json", b.errs)

		if err := tw.Close(); err != nil {
			respondWithError(w, http.StatusInternalServerError, "failed to finalize support bundle (tar): "+err.Error())
			return
		}
		if err := gz.Close(); err != nil {
			respondWithError(w, http.StatusInternalServerError, "failed to finalize support bundle (gzip): "+err.Error())
			return
		}

		filename := fmt.Sprintf("vm-import-support-%s.tar.gz", ts)
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(buf.Bytes()); err != nil {
			log.Errorf("Failed to write support bundle response: %v", err)
		}
	}
}

func newAnonSalt(enabled bool) []byte {
	if !enabled {
		return nil
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		// Degrade gracefully: a time-based salt is weaker but never panics.
		return []byte(time.Now().String())
	}
	return salt
}

func anonHash(salt []byte, s string) string {
	if s == "" {
		return ""
	}
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(s))
	return hex.EncodeToString(h.Sum(nil))[:12]
}

// anonymizeInventory replaces identifying names in an inventory tree with stable
// per-bundle hashes. Structure, sizes, counts, power state, and network/datastore
// IDs are preserved so the data still reproduces structural and mapping bugs —
// just not name-sensitive ones (a documented tradeoff of anonymization).
func anonymizeInventory(node *InventoryNode, salt []byte) {
	if node == nil {
		return
	}
	node.Name = anonHash(salt, node.Name)
	node.Folder = anonHash(salt, node.Folder)
	node.DatastoreName = anonHash(salt, node.DatastoreName)
	for i := range node.Networks {
		node.Networks[i].Name = anonHash(salt, node.Networks[i].Name)
		node.Networks[i].MAC = anonHash(salt, node.Networks[i].MAC)
	}
	for i := range node.Children {
		anonymizeInventory(&node.Children[i], salt)
	}
}
