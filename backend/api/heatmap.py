"""Heatmap API — builds adjacency matrix from identity graph for heatmap visualization."""

import json
import logging

from flask import Blueprint, jsonify

from auth.middleware import get_owned_scan, require_auth
from database import IdentityNode, IdentityEdge

heatmap_bp = Blueprint("heatmap", __name__, url_prefix="/api/heatmap")
logger = logging.getLogger(__name__)


@heatmap_bp.route("/<int:scan_id>/matrix", methods=["GET"])
@require_auth
def get_heatmap_matrix(scan_id):
    """Build an adjacency matrix from the identity graph for heatmap rendering."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    nodes = scan.nodes.all()
    edges = scan.edges.all()

    if not nodes:
        return jsonify({"labels": [], "matrix": [], "node_types": []})

    # Build label list and index map
    labels = []
    node_types = []
    node_index = {}

    for i, node in enumerate(nodes):
        label = node.label or node.node_id
        labels.append(label[:30])  # Truncate for display
        node_types.append(node.node_type)
        node_index[node.node_id] = i

    n = len(labels)

    # Initialize matrix with zeros
    matrix = [[0.0] * n for _ in range(n)]

    # Fill matrix with edge confidences
    edge_info = {}
    for edge in edges:
        src_idx = node_index.get(edge.source_id)
        tgt_idx = node_index.get(edge.target_id)
        if src_idx is not None and tgt_idx is not None:
            confidence = edge.confidence or 0.5
            matrix[src_idx][tgt_idx] = confidence
            matrix[tgt_idx][src_idx] = confidence  # Symmetric

            # Store relationship info for tooltips
            key = f"{min(src_idx, tgt_idx)}-{max(src_idx, tgt_idx)}"
            edge_info[key] = {
                "relationship": edge.relationship,
                "confidence": confidence,
            }

    # Set diagonal to 1.0 (self-connection)
    for i in range(n):
        matrix[i][i] = 1.0

    return jsonify({
        "labels": labels,
        "matrix": matrix,
        "node_types": node_types,
        "edge_info": edge_info,
        "total_nodes": n,
        "total_edges": len(edges),
    })
