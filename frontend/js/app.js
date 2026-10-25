/**
 * App Module - Main SPA router, auth check, and page lifecycle.
 */
const App = {
    init() {
        Auth.init();

        window.addEventListener('hashchange', () => {
            this.route();
        });
        this.route();

        setTimeout(() => {
            const loader = document.getElementById('app-loader');
            if (loader) loader.classList.add('hidden');
        }, 800);

        document.querySelectorAll('.nav-item').forEach((item) => {
            item.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.remove('open');
            });
        });
    },

    async route() {
        const hash = window.location.hash || '#/login';
        const path = hash.replace('#', '');
        const isAuth = await Auth.checkAuth();

        if (!isAuth && path !== '/login' && path !== '/register') {
            window.location.hash = '#/login';
            return;
        }

        if (isAuth && (path === '/login' || path === '/register')) {
            window.location.hash = '#/dashboard';
            return;
        }

        document.querySelectorAll('.page').forEach((page) => {
            page.style.display = 'none';
        });

        const sidebar = document.getElementById('sidebar');
        const mobileBtn = document.getElementById('mobile-menu-btn');
        if (path === '/login' || path === '/register') {
            if (sidebar) sidebar.style.display = 'none';
            if (mobileBtn) mobileBtn.style.display = 'none';
        } else {
            if (sidebar) sidebar.style.display = '';
            if (mobileBtn) mobileBtn.style.display = '';
        }

        const routes = {
            '/login': 'page-auth',
            '/register': 'page-auth',
            '/dashboard': 'page-dashboard',
            '/scan': 'page-scan',
            '/results': 'page-results',
            '/graph': 'page-graph',
            '/catalog': 'page-catalog',
            '/datasets': 'page-datasets',
            '/chat': 'page-chat',
            '/visualize': 'page-visualize',
            '/insights': 'page-insights',
            '/geomap': 'page-geomap',
            '/timeline': 'page-timeline',
            '/heatmap': 'page-heatmap',
            '/schedules': 'page-schedules',
            '/audit': 'page-audit',
            '/settings': 'page-settings',
            '/admin': 'page-admin',
        };

        const basePath = path.split('?')[0];
        const pageId = routes[basePath] || (path.startsWith('/graph/') ? 'page-graph' : (path.startsWith('/geomap/') ? 'page-geomap' : (path.startsWith('/timeline/') ? 'page-timeline' : (path.startsWith('/heatmap/') ? 'page-heatmap' : 'page-auth'))));
        const page = document.getElementById(pageId);
        if (page) page.style.display = 'block';

        document.querySelectorAll('.nav-item').forEach((item) => {
            const href = item.getAttribute('href');
            item.classList.toggle('active', href === hash || (path.startsWith('/graph') && href === '#/graph'));
        });

        await this.loadPage(path);
    },

    async loadPage(path) {
        // Strip query params for routing
        const basePath = path.split('?')[0];
        switch (basePath) {
            case '/dashboard':
                await Dashboard.load();
                break;
            case '/scan':
                Scanner.init();
                break;
            case '/results':
                await Results.load();
                this.initResultsActions();
                break;
            case '/graph':
                await Graph.load();
                break;
            case '/catalog':
                await Catalog.load();
                break;
            case '/datasets':
                await DatasetManager.load();
                DatasetManager.initUpload();
                break;
            case '/chat':
                await ChatUI.load();
                break;
            case '/visualize':
                await Visualize.load();
                break;
            case '/insights':
                await Insights.load();
                break;
            case '/schedules':
                if (typeof loadSchedules === 'function') loadSchedules();
                break;
            case '/audit':
                if (typeof loadAuditLogs === 'function') loadAuditLogs();
                break;
            case '/settings':
                if (typeof loadSettings === 'function') loadSettings();
                break;
            case '/admin':
                if (typeof loadAdminPanel === 'function') loadAdminPanel();
                break;
            default:
                if (basePath.startsWith('/graph/')) {
                    const scanId = parseInt(basePath.split('/')[2], 10);
                    if (scanId) await Graph.load(scanId);
                } else if (basePath.startsWith('/geomap/')) {
                    const scanId = parseInt(basePath.split('/')[2], 10);
                    if (scanId && typeof renderGeoMap === 'function') renderGeoMap(scanId);
                } else if (basePath.startsWith('/timeline/')) {
                    const scanId = parseInt(basePath.split('/')[2], 10);
                    if (scanId && typeof renderTimeline === 'function') renderTimeline(scanId);
                } else if (basePath.startsWith('/heatmap/')) {
                    const scanId = parseInt(basePath.split('/')[2], 10);
                    if (scanId && typeof renderHeatmap === 'function') renderHeatmap(scanId);
                }
                break;
        }
    },

    initResultsActions() {
        const btnGraph = document.getElementById('btn-view-graph');
        if (btnGraph) {
            btnGraph.onclick = () => {
                if (Results.currentScanId) {
                    window.location.hash = `#/graph/${Results.currentScanId}`;
                }
            };
        }

        const btnReport = document.getElementById('btn-view-report');
        if (btnReport) {
            btnReport.onclick = () => Results.showReport();
        }

        const btnDelete = document.getElementById('btn-delete-scan');
        if (btnDelete) {
            btnDelete.onclick = async () => {
                if (!Results.currentScanId) return;
                if (!confirm('Delete this scan and all associated data?')) return;

                try {
                    await API.request(`/api/export/${Results.currentScanId}/delete`, { method: 'DELETE' });
                    Toast.show('Scan deleted', 'success');
                    Results.currentScanId = null;
                    await Results.load();

                    const emptyEl = document.getElementById('results-empty');
                    const detailEl = document.getElementById('results-detail');
                    if (emptyEl) emptyEl.style.display = '';
                    if (detailEl) detailEl.style.display = 'none';
                } catch (error) {
                    Toast.show('Failed to delete scan', 'error');
                }
            };
        }

        const modalClose = document.getElementById('report-modal-close');
        const modalBackdrop = document.getElementById('report-modal-backdrop');
        const closeModal = () => {
            const modal = document.getElementById('report-modal');
            if (modal) modal.style.display = 'none';
        };
        if (modalClose) modalClose.onclick = closeModal;
        if (modalBackdrop) modalBackdrop.onclick = closeModal;
    },

    toggleMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
