// ======================= DATA & GLOBALS =======================
let processes = [];        // store {id, at, bt, pr}
const colors = ["#ff6b6b","#6bcb77","#4d96ff","#f9c74f","#9d4edd","#00bbf9","#f9844a","#43aa8f"];

// ========== Helper: clean copy ==========
function cleanCopy(arr) {
    return arr.map(p => ({
        id: p.id,
        at: p.at,
        bt: p.bt,
        pr: p.pr
    }));
}

function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ========== UI: update process table ==========
function updateTable() {
    const tbody = document.querySelector("#ptable tbody");
    if (!tbody) return;
    if (processes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No processes added</td></tr>`;
        return;
    }
    const sorted = [...processes].sort((a,b) => a.at - b.at);
    tbody.innerHTML = sorted.map(p => `
        <tr>
            <td>${p.id}</td>
            <td>${p.at}</td>
            <td>${p.bt}</td>
            <td>${p.pr}</td>
        </tr>
    `).join('');
}

function addProcess() {
    const id = document.getElementById("pid").value.trim();
    const atRaw = document.getElementById("at").value;
    const btRaw = document.getElementById("bt").value;
    const prRaw = document.getElementById("pr").value;

    if (!id || atRaw === "" || btRaw === "" || prRaw === "") {
        alert("❌ All fields are required");
        return;
    }
    const at = Number(atRaw);
    const bt = Number(btRaw);
    const pr = Number(prRaw);
    if (isNaN(at) || isNaN(bt) || isNaN(pr)) {
        alert("❌ Invalid numeric values");
        return;
    }
    if (at < 0 || bt <= 0) {
        alert("❌ AT >=0 and BT > 0");
        return;
    }
    if (processes.some(p => p.id === id)) {
        alert("❌ Duplicate Process ID!");
        return;
    }
    processes.push({ id, at, bt, pr });
    updateTable();
    // clear inputs for convenience
    document.getElementById("pid").value = "";
    document.getElementById("at").value = "";
    document.getElementById("bt").value = "";
    document.getElementById("pr").value = "";
}

function clearAll() {
    processes = [];
    updateTable();
    document.getElementById("rrGantt").innerHTML = "";
    document.getElementById("prGantt").innerHTML = "";
    document.getElementById("rrTable").innerHTML = "";
    document.getElementById("prTable").innerHTML = "";
    document.getElementById("legend").innerHTML = "";
    document.getElementById("report").innerHTML = "";
}

// ========== LEGEND ==========
function createLegend() {
    const legendDiv = document.getElementById("legend");
    legendDiv.innerHTML = "";
    processes.forEach((p, idx) => {
        const div = document.createElement("div");
        div.className = "legend-item";
        div.style.backgroundColor = colors[idx % colors.length];
        div.innerText = p.id;
        legendDiv.appendChild(div);
    });
    if (processes.length === 0) legendDiv.innerHTML = "<span style='color:white; background:#333; padding:4px 12px; border-radius:30px;'>No processes</span>";
}

// ========== CALCULATION UTILITY ==========
function computeMetrics(processArr, ganttEvents) {
    // ganttEvents: list of {id, start, end}
    let ctMap = {};
    let startMap = {};
    // initialize startMap for each process
    processArr.forEach(p => { startMap[p.id] = -1; });
    for (let ev of ganttEvents) {
        if (ev.id !== "Idle") {
            ctMap[ev.id] = ev.end;   // completion time = latest end
            if (startMap[ev.id] === -1) startMap[ev.id] = ev.start;
            else startMap[ev.id] = Math.min(startMap[ev.id], ev.start);
        }
    }
    const results = processArr.map(p => {
        const ct = ctMap[p.id];
        const tat = ct - p.at;
        const wt = tat - p.bt;
        const rt = startMap[p.id] - p.at;
        return {
            id: p.id,
            ct: ct,
            wt: wt >= 0 ? wt : 0,
            tat: tat,
            rt: rt >= 0 ? rt : 0
        };
    });
    return {
        result: results,
        avgWT: avg(results.map(r => r.wt)),
        avgTAT: avg(results.map(r => r.tat)),
        avgRT: avg(results.map(r => r.rt))
    };
}

// ---------- ROUND ROBIN (preemptive by quantum) ----------
function roundRobin(procList, quantum) {
    let processesRR = procList.map(p => ({
        id: p.id, at: p.at, bt: p.bt, pr: p.pr,
        rem: p.bt,
        start: -1,
        visited: false
    }));
    let time = 0;
    let queue = [];
    let ganttRaw = [];
    let completed = 0;
    const total = processesRR.length;

    while (completed < total) {
        // add newly arrived processes
        for (let p of processesRR) {
            if (p.at <= time && !p.visited && p.rem > 0) {
                queue.push(p);
                p.visited = true;
            }
        }
        if (queue.length === 0) {
            ganttRaw.push({ id: "Idle", start: time, end: time + 1 });
            time++;
            continue;
        }
        let current = queue.shift();
        if (current.start === -1) current.start = time;
        let exec = Math.min(quantum, current.rem);
        ganttRaw.push({ id: current.id, start: time, end: time + exec });
        time += exec;
        current.rem -= exec;

        // add arrivals DURING this execution window
        for (let p of processesRR) {
            if (!p.visited && p.at > (time - exec) && p.at <= time && p.rem > 0) {
                queue.push(p);
                p.visited = true;
            }
        }
        if (current.rem > 0) {
            queue.push(current);
        } else {
            completed++;
        }
    }
    // compress gantt
    const mergedGantt = compressGantt(ganttRaw);
    const metrics = computeMetrics(procList, mergedGantt);
    return { gantt: mergedGantt, ...metrics };
}

// ---------- PREEMPTIVE PRIORITY (higher priority => lower pr number) ----------
function priorityPreemptive(procList) {
    let procCopy = procList.map(p => ({
        id: p.id, at: p.at, bt: p.bt, pr: p.pr,
        rem: p.bt,
        start: -1
    }));
    let time = 0;
    let ganttRaw = [];
    let completed = 0;
    const total = procCopy.length;
    let lastProcess = null;

    while (completed < total) {
        // get available processes
        let available = procCopy.filter(p => p.at <= time && p.rem > 0);
        if (available.length === 0) {
            // idle until next arrival
            let nextArrival = Math.min(...procCopy.filter(p => p.rem > 0).map(p => p.at));
            if (nextArrival === Infinity) break;
            ganttRaw.push({ id: "Idle", start: time, end: nextArrival });
            time = nextArrival;
            continue;
        }
        // sort by priority (lower number higher) and then by arrival tie (FCFS)
        available.sort((a,b) => {
            if (a.pr !== b.pr) return a.pr - b.pr;
            return a.at - b.at;
        });
        let current = available[0];
        if (current.start === -1) current.start = time;
        // preemptive: run 1 unit then check for higher priority arrival
        ganttRaw.push({ id: current.id, start: time, end: time + 1 });
        time++;
        current.rem--;
        if (current.rem === 0) completed++;
    }
    const merged = compressGantt(ganttRaw);
    const metrics = computeMetrics(procList, merged);
    return { gantt: merged, ...metrics };
}

// compress consecutive same-id blocks
function compressGantt(ganttArr) {
    if (!ganttArr.length) return [];
    let merged = [];
    for (let seg of ganttArr) {
        let last = merged[merged.length - 1];
        if (last && last.id === seg.id && last.end === seg.start) {
            last.end = seg.end;
        } else {
            merged.push({ ...seg });
        }
    }
    return merged;
}

// ========== DISPLAY WITH PRECISE TIME ALIGNMENT ==========
function renderGantt(ganttData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = ""; 
    if (!ganttData || ganttData.length === 0) {
        container.innerHTML = "<div style='padding:20px; text-align:center'>No Gantt data</div>";
        return;
    }
    // wrapper style for overflow
    const ganttWrapper = document.createElement("div");
    ganttWrapper.className = "gantt-container";
    
    const blocksRow = document.createElement("div");
    blocksRow.className = "gantt-blocks";
    
    const timeRow = document.createElement("div");
    timeRow.className = "time-axis";
    
    let cumulative = 0;
    const timeMarkers = [];
    
    for (let i = 0; i < ganttData.length; i++) {
        const seg = ganttData[i];
        const duration = seg.end - seg.start;
        const widthPx = duration * 42;   // 42px per unit for better readability & alignment
        // Block style
        const block = document.createElement("div");
        block.className = "block";
        block.style.width = widthPx + "px";
        block.style.minWidth = "28px";
        // color handling
        let color = "#aaaaaa";
        if (seg.id !== "Idle") {
            const idx = processes.findIndex(p => p.id === seg.id);
            color = idx !== -1 ? colors[idx % colors.length] : "#4d96ff";
        } else {
            color = "#8c92ac";
        }
        block.style.backgroundColor = color;
        block.innerText = seg.id === "Idle" ? "🕒" : seg.id;
        block.style.fontSize = "13px";
        blocksRow.appendChild(block);
        
        // time marker (start time)
        const markerSpan = document.createElement("span");
        markerSpan.className = "time-marker";
        markerSpan.style.width = widthPx + "px";
        markerSpan.style.display = "inline-block";
        markerSpan.style.textAlign = "left";
        markerSpan.style.paddingLeft = "4px";
        markerSpan.innerText = seg.start;
        timeRow.appendChild(markerSpan);
        cumulative = seg.end;
    }
    // final end time marker
    const finalMarker = document.createElement("span");
    finalMarker.className = "time-marker";
    finalMarker.style.display = "inline-block";
    finalMarker.style.fontWeight = "bold";
    finalMarker.innerText = cumulative;
    timeRow.appendChild(finalMarker);
    
    ganttWrapper.appendChild(blocksRow);
    ganttWrapper.appendChild(timeRow);
    container.appendChild(ganttWrapper);
}

function renderMetricsTable(metricsResult, tableId) {
    const tableElem = document.getElementById(tableId);
    if (!tableElem) return;
    let html = `<table style="width:100%; margin-top: 12px;">
        <thead><tr><th>ID</th><th>CT</th><th>WT</th><th>TAT</th><th>RT</th></tr></thead>
        <tbody>`;
    metricsResult.result.forEach(r => {
        html += `<tr>
            <td>${r.id}</td>
            <td>${r.ct}</td>
            <td>${r.wt}</td>
            <td>${r.tat}</td>
            <td>${r.rt}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    tableElem.innerHTML = html;
}

function showInsightReport(rrMetrics, prMetrics) {
    const reportDiv = document.getElementById("report");
    const quantumVal = document.getElementById("quantum").value;
    reportDiv.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:20px; justify-content:space-between;">
            <div style="background:#fff3e0; border-radius:20px; padding:12px 18px; flex:1;">
                <h4 style="margin:0 0 8px 0">🔄 Round Robin (Q=${quantumVal})</h4>
                <p>⚡ Avg Waiting Time: <strong>${rrMetrics.avgWT.toFixed(2)}</strong><br>
                📊 Avg Turnaround: <strong>${rrMetrics.avgTAT.toFixed(2)}</strong><br>
                🚀 Avg Response Time: <strong>${rrMetrics.avgRT.toFixed(2)}</strong></p>
            </div>
            <div style="background:#e4f0fa; border-radius:20px; padding:12px 18px; flex:1;">
                <h4 style="margin:0 0 8px 0">⚡ Preemptive Priority</h4>
                <p>⚡ Avg Waiting Time: <strong>${prMetrics.avgWT.toFixed(2)}</strong><br>
                📊 Avg Turnaround: <strong>${prMetrics.avgTAT.toFixed(2)}</strong><br>
                🚀 Avg Response Time: <strong>${prMetrics.avgRT.toFixed(2)}</strong></p>
            </div>
        </div>
        <hr style="margin:16px 0">
        <p style="font-size:14px">✅ <strong>Analysis:</strong> 
        ${rrMetrics.avgWT < prMetrics.avgWT ? "🔹 Round Robin provides lower average waiting time in this scenario." : "🔸 Priority scheduling may favor urgent tasks but can increase waiting time for low-priority processes."}
        Priority scheduling ensures time-critical tasks run first, while RR provides fairness and avoids starvation.
        </p>
    `;
}

// ========== MAIN SIMULATION ==========
function runSimulation() {
    if (processes.length === 0) {
        alert("⚠️ No processes to simulate. Please add at least one process.");
        return;
    }
    const quantumVal = document.getElementById("quantum").value;
    const q = Number(quantumVal);
    if (isNaN(q) || q <= 0) {
        alert("❌ Invalid Time Quantum. Please enter a positive number.");
        return;
    }
    createLegend();
    const rrProcCopy = cleanCopy(processes);
    const prProcCopy = cleanCopy(processes);
    
    // Run algorithms
    const rrResult = roundRobin(rrProcCopy, q);
    const prResult = priorityPreemptive(prProcCopy);
    
    // Display Gantt charts with fixed alignment
    renderGantt(rrResult.gantt, "rrGantt");
    renderGantt(prResult.gantt, "prGantt");
    
    // Display metrics tables
    renderMetricsTable(rrResult, "rrTable");
    renderMetricsTable(prResult, "prTable");
    
    // Comparison report
    showInsightReport(rrResult, prResult);
}

// initial table sync
updateTable();