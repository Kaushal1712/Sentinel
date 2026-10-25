// Investigation Timeline using D3.js

let timelineSvg = null;

async function loadTimelineData(scanId) {
    if (!scanId) return;

    try {
        const resp = await req(`/api/timeline/${scanId}/events`);

        if (!resp.events || resp.events.length === 0) {
            document.getElementById('timeline-status').innerText = 'No timestamped events found.';
            document.getElementById('timeline-status').style.display = 'block';
            return;
        }

        renderD3Timeline(resp.events);
    } catch (e) {
        console.error("Failed to load timeline data", e);
        document.getElementById('timeline-status').innerText = 'Error loading timeline.';
        document.getElementById('timeline-status').style.display = 'block';
    }
}

function renderD3Timeline(events) {
    const container = document.getElementById('timeline-svg');
    container.innerHTML = '';
    document.getElementById('timeline-status').style.display = 'none';

    // Sort events by date
    events.forEach(d => {
        d.parsedDate = new Date(d.date);
    });

    const margin = {top: 40, right: 40, bottom: 40, left: 40};
    const width = container.clientWidth - margin.left - margin.right;
    const height = 150 - margin.top - margin.bottom;

    const minDate = d3.min(events, d => d.parsedDate);
    const maxDate = d3.max(events, d => d.parsedDate);

    const x = d3.scaleTime()
        .domain([minDate, maxDate])
        .range([0, width]);

    const svg = d3.select("#timeline-svg")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Axis
    const xAxis = d3.axisBottom(x)
        .ticks(width / 80)
        .tickSizeOuter(0);

    svg.append("g")
        .attr("transform", `translate(0,${height/2})`)
        .attr("class", "timeline-axis")
        .call(xAxis)
        .selectAll("text")
        .attr("fill", "#94a3b8")
        .style("font-size", "10px");

    svg.selectAll(".domain, .tick line")
        .attr("stroke", "#334155");

    // Tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "d3-tooltip")
        .style("opacity", 0)
        .style("position", "absolute")
        .style("background", "#1e293b")
        .style("border", "1px solid #334155")
        .style("border-radius", "8px")
        .style("padding", "10px")
        .style("color", "#f1f5f9")
        .style("font-size", "12px")
        .style("pointer-events", "none")
        .style("z-index", "1000")
        .style("box-shadow", "0 4px 6px rgba(0,0,0,0.3)");

    // Color mapping
    const colorScale = {
        'critical': '#ef4444',
        'high': '#f97316',
        'medium': '#eab308',
        'low': '#3b82f6',
        'none': '#94a3b8'
    };

    // Nodes
    const nodes = svg.selectAll(".node")
        .data(events)
        .enter().append("circle")
        .attr("class", "node")
        .attr("cx", d => x(d.parsedDate))
        .attr("cy", height/2)
        .attr("r", 6)
        .attr("fill", d => colorScale[d.risk_level] || colorScale.low)
        .attr("stroke", "#0f172a")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 10);

            let html = `<strong>${d.label}</strong><br>`;
            html += `<span style="color:#94a3b8;font-size:10px">${d.parsedDate.toISOString().split('T')[0]}</span><br>`;
            html += `<span style="color:#cbd5e1">${d.detail}</span>`;

            tooltip.transition()
                .duration(200)
                .style("opacity", .9);
            tooltip.html(html)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 6);

            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        })
        .on("click", function(event, d) {
            if (d.url) window.open(d.url, '_blank');
        });

    // Type filters summary
    const summary = document.getElementById("timeline-summary");
    if (summary) {
        summary.innerHTML = '';
        const types = d3.rollup(events, v => v.length, d => d.type);
        types.forEach((count, type) => {
            const badge = document.createElement("span");
            badge.className = "filter-badge";
            badge.innerText = `${type.toUpperCase()}: ${count}`;
            summary.appendChild(badge);
        });
    }
}

window.renderTimeline = function(scanId) {
    document.getElementById("timeline-summary").innerHTML = '';
    loadTimelineData(scanId);
};
