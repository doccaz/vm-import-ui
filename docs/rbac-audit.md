# ClusterRole audit

Method: every `Clientset.*` and `Dynamic.Resource(...)` call in `pkg/*.go`
(non-test) was enumerated and mapped to a rule in
`charts/vm-import-ui/templates/clusterrole.yaml`. Re-run when adding handlers:

    SRC=$(ls pkg/*.go | grep -v _test.go)
    grep -ohE "Clientset\.[A-Za-z0-9]+\(\)(\.[A-Za-z]+\([^)]*\))?\.[A-Za-z]+\(" $SRC | sort | uniq -c
    grep -ohE "Dynamic\.Resource\([A-Za-z]+\)(\.Namespace\([^)]*\))?\.[A-Za-z]+\(" $SRC | sort | uniq -c

Removed from the previous role because no code path uses them: `nodes`, `events`,
`configmaps`, `persistentvolumes`, `apps/*`, CDI (`datavolumes`, `datasources`),
the `harvesterhci.io/*` wildcard (only `settings` get is used),
`virtualmachineinstancemigrations`, all `watch` verbs, `forklift hosts`, and
write access to `kubevirt.io` resources, except `virtualmachines` `create`
(see below).

What this grep cannot see:

- **Admission-time checks.** Forklift's plan webhook requires the requester to be
  able to `create` `virtualmachines.kubevirt.io` in the plan's target namespace,
  although the UI never makes that call. That one rule is kept for it. When
  adding a Forklift or Harvester resource, create it through the UI on a cluster
  and read any "forbidden" from the admission webhook.
- **Clients held in a variable.** `pvcs := ...PersistentVolumeClaims(ns)` followed
  by `pvcs.Get` / `pvcs.Create` shows up in the grep with no verb. Read those by
  hand (`pkg/export.go`).

Secrets are the sensitive part: only get/create/update/delete by name, no
list/watch. A ClusterRole cannot be limited to a namespace, so the ServiceAccount
can still read any Secret whose name it knows. Restricting *who can open the UI*
(`access.users` / `access.groups`) and not exposing it on a NodePort
(`service.type=ClusterIP`) are the mitigations available in this chart.

Gated by chart values: `export.enabled` (jobs, PVC create).
