# On-Call Horror

Real ArgoCD/Kubernetes on-call incidents you can practice fixing - locally,
for free, with no account and no hosted infrastructure.

Each scenario spins up a real disposable [`kind`](https://kind.sigs.k8s.io/)
cluster with [ArgoCD](https://argo-cd.readthedocs.io/) installed, deliberately
broken the way a real on-call page would be, deployed via a real local
GitOps repo (not a simulation). You fix it with your own `kubectl`/`argocd`,
then a `check.sh` script verifies your fix against the live cluster.

Inspired by [sadservers.com](https://sadservers.com), but scoped to
ArgoCD/Kubernetes on-call work and run entirely on your own machine instead
of hosted servers.

## Prerequisites

- [Docker](https://www.docker.com/) (Desktop or Engine), running
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/#kubectl)
- [git](https://git-scm.com/)
- [argocd CLI](https://argo-cd.readthedocs.io/en/stable/cli_installation/)
- Python 3.10+

Verify everything is in place:

```bash
oncallhorror doctor
```

## Install

```bash
pip install -e cli/
```

## Quickstart

```bash
oncallhorror list                      # browse scenarios
oncallhorror info stuck-at-3am         # read the full incident description
oncallhorror start stuck-at-3am        # spin up the cluster, pre-broken
#  ... go fix it with kubectl/argocd ...
oncallhorror check stuck-at-3am        # verify your fix
oncallhorror hint stuck-at-3am         # stuck? progressive hints
oncallhorror solution stuck-at-3am     # full walkthrough (spoilers)
oncallhorror stop stuck-at-3am         # tear down this scenario's cluster
oncallhorror clean                     # tear down everything
```

## How it works

- `oncallhorror start <id>` builds (once) and starts a shared local
  `oncallhorror-gitd` container that serves each scenario's GitOps source
  over `git://` on the `kind` docker network, creates a fresh `kind`
  cluster, installs ArgoCD, and applies the scenario's `Application` (and
  any `AppProject`) manifests - which then sync from that local git repo,
  the same way ArgoCD would sync from GitHub/GitLab in production.
- Where a scenario's fix belongs in the GitOps source (not just live
  cluster state), the CLI prints the local path to that repo's working
  copy - edit files there directly and `git commit`; no push needed, since
  it's already what ArgoCD is pulling from.
- `oncallhorror check <id>` runs that scenario's `check.sh` against your
  current kube context and reports pass/fail.
- Nothing is hosted: no accounts, no servers, no cost. Only real ArgoCD/
  Kubernetes behavior, running on your machine.

## Scenarios

Run `oncallhorror list` for the full, current list with difficulty/type/time.
Browse them with descriptions at [`docs/index.html`](docs/index.html) (or the
published GitHub Pages site, once you deploy it).

## Adding a new scenario

Create `scenarios/NNN-your-slug/` with:

- `scenario.yaml` - metadata: `id`, `title`, `subtitle`, `difficulty`
  (`easy`/`medium`/`hard`), `type` (`fix`/`do`/`hack`), `time_minutes`,
  `tags`, `description`, `constraints`, `test_description`.
- `app-repo/` - the GitOps source ArgoCD syncs from. Any `*.yaml` file
  directly under `app-repo/` (e.g. `application.yaml`, `00-project.yaml`)
  is applied to the cluster as a bootstrap resource by `oncallhorror
  start`; everything under `app-repo/manifests/` (or wherever the
  Application's `spec.source.path` points) is what actually gets seeded
  into the served git repo and synced by ArgoCD. Point
  `spec.source.repoURL` at `git://oncallhorror-gitd/<id>.git`.
- `break.sh` (optional) - extra tampering that can't be expressed as
  GitOps source, e.g. simulating a manual `kubectl` change. Reads
  `$KUBE_CONTEXT` from its environment.
- `check.sh` - pass/fail validation. `source ../_lib/check_helpers.sh` for
  `assert_app_synced_healthy`, `assert_pods_running`, `pass`, `fail`, and
  the pre-built `$KC` kubectl-with-context array.
- `hints.md` - `## `-delimited sections, revealed progressively by
  `oncallhorror hint --level N`.
- `solution.md` - full walkthrough.

Use an existing scenario (e.g. `scenarios/001-stuck-at-3am/`) as a template.

## Static catalog site

```bash
cd site
pip install -r requirements.txt
python generate_site.py
```

Renders `docs/index.html` plus one detail page per scenario. Publish it for
free with GitHub Pages: repo Settings -> Pages -> Deploy from branch ->
`/docs`.

## Troubleshooting

- **A scenario's pods can't reach the git-daemon container by name**: this
  relies on Docker's embedded DNS resolving container names for other
  containers on the same user-defined bridge network (`kind`), forwarded
  through the kind node's resolver. This works with Docker Desktop's
  default networking; if you're on an unusual Docker/CNI setup and it
  doesn't resolve, check `kubectl -n argocd logs deploy/argocd-repo-server`
  for the underlying DNS/connection error.
- **`oncallhorror doctor` reports `argocd` missing**: install the
  [argocd CLI](https://argo-cd.readthedocs.io/en/stable/cli_installation/)
  - several scenarios use `argocd app sync`/`terminate-op` in their hints
    and solutions.
- **Leftover clusters/containers**: `kind get clusters` and `docker ps` to
  see what's still running; `oncallhorror clean` tears everything down.

## License

MIT - see [LICENSE](LICENSE).
