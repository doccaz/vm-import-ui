# ClusterRole audit

Method: every `Clientset.*` and `Dynamic.Resource(...)` call in `pkg/*.go`
(non-test) was enumerated and mapped to a rule in
`charts/vm-import-ui/templates/clusterrole.yaml`. Re-run when adding handlers:

    grep -ohE "Clientset\.[A-Za-z0-9]+\(\)(\.[A-Za-z]+\([^)]*\))?\.[A-Za-z]+\(" pkg/*.go | sort | uniq -c
    grep -ohE "Dynamic\.Resource\([A-Za-z]+\)(\.Namespace\([^)]*\))?\.[A-Za-z]+\(" pkg/*.go | sort | uniq -c

Removed from the previous role because no code path uses them: `nodes`, `events`,
`configmaps`, `persistentvolumes`, `apps/*`, CDI (`datavolumes`, `datasources`),
the `harvesterhci.io/*` wildcard (only `settings` get is used),
`virtualmachineinstancemigrations`, all `watch` verbs, `forklift hosts`, and
write access to `kubevirt.io` resources (the UI only reads VMs).

Secrets are the sensitive part: only get/create/update/delete by name, no
list/watch. A ClusterRole cannot be limited to a namespace, so the ServiceAccount
can still read any Secret whose name it knows. Restricting *who can open the UI*
(`access.users` / `access.groups`) and not exposing it on a NodePort
(`service.type=ClusterIP`) are the mitigations available in this chart.

Gated by chart values: `export.enabled` (jobs, PVC create).
