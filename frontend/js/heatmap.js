// Adjacency Matrix Heatmap using D3.js

async function loadHeatmapData(scanId) {
    if (!scanId) return;

    try {
        const resp = await req(`/api/heatmap/${scanId}/matrix`);

        if (!resp.matrix || resp.matrix.length === 0) {
            document.getElementById('heatmap-status').innerText = 'No relation data found.';
            document.getElementById('heatmap-status').style.display = 'block';
            return;
        }

        renderD3Heatmap(resp);
    } catch (e) {
        console.error("Failed to load heatmap data", e);
        document.getElementById('heatmap-status').innerText = 'Error loading heatmap.';
        document.getElementById('heatmap-status').style.display = 'block';
    }
}

function renderD3Heatmap(data) {
    const container = document.getElementById('heatmap-svg');
    container.innerHTML = '';
    document.getElementById('heatmap-status').style.display = 'none';

    const margin = {top: 100, right: 20, bottom: 20, left: 100};
    const cellSize = Math.min(30, Math.max(10, 500 / data.labels.length));
    const width = cellSize * data.labels.length;
    const height = cellSize * data.labels.length;

    const svg = d3.select("#heatmap-svg")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Labels
    const labels = data.labels;

    // X scale
    const x = d3.scaleBand()
        .domain(d3.range(labels.length))
        .range([0, width]);

    // Y scale
    const y = d3.scaleBand()
        .domain(d3.range(labels.length))
        .range([0, height]);

    // Color scale for confidence (0.0 to 1.0)
    // Dark mode friendly blue scale
    const colorScale = d3.scaleSequential()
        .interpolator(d3.interpolateBlues)
        .domain([0, 1]);

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

    // Draw cells
    for (let row = 0; row < labels.length; row++) {
        for (let col = 0; col < labels.length; col++) {
            const val = data.matrix[row][col];
            if (val > 0) {
                // Determine edge info if any
                const key1 = `${Math.min(row, col)}-${Math.max(row, col)}`;
                const edgeInfo = data.edge_info && data.edge_info[key1] ? data.edge_info[key1] : null;

                svg.append("rect")
                    .attr("x", x(col))
                    .attr("y", y(row))
                    .attr("width", x.bandwidth() - 1)
                    .attr("height", y.bandwidth() - 1)
                    .attr("fill", val === 1.0 && row === col ? '#334155' : colorScale(val))
                    .attr("rx", 2)
                    .on("mouseover", function(event) {
                        d3.select(this).attr("stroke", "#ffed4a").attr("stroke-width", 2);

                        let html = `<strong>${labels[row]}</strong> ↔ <strong>${labels[col]}</strong><br>`;
                        html += `Confidence: ${(val*100).toFixed(0)}%<br>`;
                        if (edgeInfo) {
                            html += `<span style="color:#94a3b8">Relation: ${edgeInfo.relationship}</span>`;
                        }

                        tooltip.transition().duration(200).style("opacity", .9);
                        tooltip.html(html)
                            .style("left", (event.pageX + 15) + "px")
                            .style("top", (event.pageY - 28) + "px");
                    })
                    .on("mouseout", function() {
                        d3.select(this).attr("stroke", "none");
                        tooltip.transition().duration(500).style("opacity", 0);
                    });
            }
        }
    }

    // Draw row labels
    svg.selectAll(".rowLabel")
        .data(labels)
        .enter().append("text")
        .text(d => d.length > 15 ? d.substring(0, 15) + "..." : d)
        .attr("x", -5)
        .attr("y", (d, i) => y(i) + y.bandwidth() / 2)
        .attr("dy", ".32em")
        .attr("text-anchor", "end")
        .attr("class", "matrix-label")
        .style("font-size", Math.min(12, cellSize - 2) + "px")
        .style("fill", "#94a3b8");

    // Draw col labels
    svg.selectAll(".colLabel")
        .data(labels)
        .enter().append("text")
        .text(d => d.length > 15 ? d.substring(0, 15) + "..." : d)
        .attr("x", 5)
        .attr("y", (d, i) => x(i) + x.bandwidth() / 2)
        .attr("dy", ".32em")
        .attr("text-anchor", "start")
        .attr("class", "matrix-label")
        .attr("transform", (d, i) => `rotate(-45, ${x(i) + x.bandwidth()/2}, -5) translate(0, -5)`)
        .style("font-size", Math.min(12, cellSize - 2) + "px")
        .style("fill", "#94a3b8");
}

window.renderHeatmap = function(scanId) {
    loadHeatmapData(scanId);
};
