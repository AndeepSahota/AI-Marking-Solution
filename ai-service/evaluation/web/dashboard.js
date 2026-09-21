const targetList = document.querySelector("#target-list");
const targetCount = document.querySelector("#target-count");
const content = document.querySelector("#dashboard-content");
const refreshButton = document.querySelector("#refresh-button");

let selectedTargetId = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return Number(value).toLocaleString();
}

function formatDuration(value) {
    if (value === null || value === undefined) return "—";
    if (value < 1000) return `${formatNumber(value)} ms`;
    return `${(value / 1000).toFixed(2)} s`;
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
}

function statusClass(value) {
    const allowed = new Set(["complete", "failed", "complete_with_failures", "running"]);
    return allowed.has(value) ? value : "";
}

async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || `Request failed with HTTP ${response.status}`);
    }
    return body;
}

function showError(message) {
    content.innerHTML = `
        <section class="error-state">
            <p class="eyebrow">Unable to load data</p>
            <h2>Evaluation dashboard error</h2>
            <p class="muted">${escapeHtml(message)}</p>
        </section>
    `;
}

function renderTargets(targets) {
    targetCount.textContent = targets.length;
    targetList.replaceChildren();

    if (!targets.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No targets have been created.";
        targetList.append(empty);
        return;
    }

    for (const target of targets) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "target-button";
        button.dataset.targetId = target.target_id;
        button.setAttribute("aria-pressed", target.target_id === selectedTargetId ? "true" : "false");

        const id = document.createElement("span");
        id.className = "target-id";
        id.textContent = target.target_id;

        const label = document.createElement("span");
        label.className = "target-label";
        const name = document.createElement("strong");
        name.textContent = target.name;
        const meta = document.createElement("span");
        meta.textContent = `${target.runner_key} · ${target.result_count} results`;
        label.append(name, meta);
        button.append(id, label);

        if (target.target_id === selectedTargetId) {
            button.classList.add("active");
        }
        button.addEventListener("click", () => selectTarget(target.target_id));
        targetList.append(button);
    }
}

function metric(label, value) {
    return `
        <div class="metric">
            <span class="metric-label">${escapeHtml(label)}</span>
            <span class="metric-value">${escapeHtml(value)}</span>
        </div>
    `;
}

function renderEvaluation(evaluation) {
    const results = evaluation.results || [];
    const durations = results
        .map((result) => result.performance?.duration_ms)
        .filter((value) => typeof value === "number");
    const averageDuration = durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null;
    const totalTokens = results.reduce(
        (sum, result) => sum + (result.performance?.total_tokens || 0),
        0,
    );
    const completed = results.filter((result) => result.status === "complete").length;

    const card = document.createElement("article");
    card.className = "evaluation-card";
    card.innerHTML = `
        <div class="evaluation-header">
            <div>
                <p class="eyebrow">Evaluation ${escapeHtml(evaluation.evaluation_id)}</p>
                <h3>${escapeHtml(evaluation.name)}</h3>
                <p class="muted">Started ${escapeHtml(formatDate(evaluation.started_at))}</p>
            </div>
            <div class="dataset-badge">Dataset #${escapeHtml(evaluation.dataset_id)} · ${escapeHtml(evaluation.dataset_name)} v${escapeHtml(evaluation.dataset_version)}</div>
        </div>
        <div class="metrics">
            ${metric("Status", evaluation.status)}
            ${metric("Completed runs", `${completed}/${evaluation.requested_runs}`)}
            ${metric("Average time", formatDuration(averageDuration))}
            ${metric("Total tokens", formatNumber(totalTokens))}
            ${metric("Model", evaluation.model_requested)}
            ${metric("Prompt ID", evaluation.prompt_id)}
        </div>
        <div class="results-wrap">
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Run</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Prompt tokens</th>
                        <th>Completion</th>
                        <th>Total</th>
                        <th>Finish</th>
                        <th>Output</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        </div>
    `;

    const body = card.querySelector("tbody");
    for (const result of results) {
        const performance = result.performance || {};
        const row = document.createElement("tr");
        const outputLabel = result.error_message ? "View error" : "View JSON";
        row.innerHTML = `
            <td class="numeric">${escapeHtml(result.run_number)}</td>
            <td><span class="status ${statusClass(result.status)}">${escapeHtml(result.status)}</span></td>
            <td class="numeric">${escapeHtml(formatDuration(performance.duration_ms))}</td>
            <td class="numeric">${escapeHtml(formatNumber(performance.prompt_tokens))}</td>
            <td class="numeric">${escapeHtml(formatNumber(performance.completion_tokens))}</td>
            <td class="numeric">${escapeHtml(formatNumber(performance.total_tokens))}</td>
            <td>${escapeHtml(performance.finish_reason || "—")}</td>
            <td>
                <details>
                    <summary>${outputLabel}</summary>
                    <pre class="${result.error_message ? "error-message" : "result-json"}"></pre>
                </details>
            </td>
        `;
        const output = row.querySelector("pre");
        output.textContent = result.error_message
            || JSON.stringify(result.actual_result, null, 2)
            || "No output was stored.";
        body.append(row);
    }

    if (!results.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="8" class="muted">No result rows were stored for this evaluation.</td>';
        body.append(row);
    }

    return card;
}

function renderTarget(data) {
    const { target, evaluations } = data;
    content.replaceChildren();

    const header = document.createElement("section");
    header.className = "target-header";
    header.innerHTML = `
        <div>
            <p class="eyebrow">Target ${escapeHtml(target.target_id)}</p>
            <h2>${escapeHtml(target.name)}</h2>
            <p class="muted">${escapeHtml(target.description || "No target description supplied.")}</p>
        </div>
        <div class="target-meta">
            <span class="pill">${escapeHtml(target.runner_key)}</span>
            <span class="pill">${escapeHtml(target.target_key)}</span>
            <span class="pill">${evaluations.length} evaluation${evaluations.length === 1 ? "" : "s"}</span>
        </div>
    `;
    content.append(header);

    if (!evaluations.length) {
        const empty = document.createElement("section");
        empty.className = "empty-state";
        empty.innerHTML = `
            <p class="eyebrow">No evaluations</p>
            <h2>This target has no stored runs yet.</h2>
            <p class="muted">Run it through the CLI, then refresh this page.</p>
        `;
        content.append(empty);
        return;
    }

    const list = document.createElement("section");
    list.className = "evaluation-list";
    for (const evaluation of evaluations) {
        list.append(renderEvaluation(evaluation));
    }
    content.append(list);
}

async function selectTarget(targetId) {
    selectedTargetId = targetId;
    for (const button of targetList.querySelectorAll(".target-button")) {
        const isActive = Number(button.dataset.targetId) === Number(targetId);
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    content.innerHTML = '<section class="empty-state"><p class="muted">Loading evaluation results…</p></section>';
    try {
        renderTarget(await getJson(`/api/targets/${targetId}`));
    } catch (error) {
        showError(error.message);
    }
}

async function loadDashboard() {
    try {
        const { targets } = await getJson("/api/targets");
        renderTargets(targets);
        if (selectedTargetId && targets.some((target) => target.target_id === selectedTargetId)) {
            await selectTarget(selectedTargetId);
        } else if (targets.length) {
            await selectTarget(targets[0].target_id);
        }
    } catch (error) {
        targetList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
        showError(error.message);
    }
}

refreshButton.addEventListener("click", loadDashboard);
loadDashboard();
