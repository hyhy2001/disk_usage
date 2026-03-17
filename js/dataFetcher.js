import { UINodes, AppState, animateValue, bytesToTB } from './main.js';
import { DataStore } from './dataStore.js';
import { ChartManager } from './chartManager.js';

class DataFetcher {
    constructor() {
        this.dataStore = new DataStore();
        
        // Initialize charts
        AppState.chartManagerInstance = new ChartManager();

        // Bind events
        if (UINodes.btnFetch) {
            UINodes.btnFetch.addEventListener('click', () => this.startServerSync());
        }

        // Auto-run on load
        setTimeout(() => this.startServerSync(), 500);
    }

    async startServerSync() {
        if (AppState.isProcessing) return;
        
        try {
            this.setProcessingState(true);
            UINodes.statusText.textContent = "Connecting to API...";
            
            // 1. Fetch unified payload from PHP Backend
            const response = await fetch('api.php');
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} from api.php.`);
            }

            const jsonResponse = await response.json();
            
            if (jsonResponse.status !== 'success' || !jsonResponse.data || jsonResponse.data.length === 0) {
                alert("No JSON reports found or API returned an error.");
                this.setProcessingState(false);
                return;
            }

            UINodes.statusText.textContent = "Loading payload...";
            AppState.filesTotal = jsonResponse.total_files;
            UINodes.filesProcessed.textContent = `0/${AppState.filesTotal} files`;
            
            // 2. Clear old data store and reset charts
            this.dataStore = new DataStore();
            
            // 3. Process the massive data array instantly
            UINodes.statusText.textContent = "Aggregating metrics...";
            
            this.dataStore.processChunk(jsonResponse.data);
            
            // Instantly jump progress to 100% since it's a single payload
            AppState.filesProcessed = AppState.filesTotal;
            UINodes.progressBar.style.width = `100%`;
            UINodes.filesProcessed.textContent = `${AppState.filesTotal}/${AppState.filesTotal} files`;

            // 4. Finalize
            this.handleComplete();
            
        } catch (error) {
            console.error("Server API Sync Failed:", error);
            this.setProcessingState(false);
            UINodes.statusText.textContent = "Error: " + error.message;
            UINodes.statusDot.classList.remove('scanning');
            UINodes.statusDot.style.backgroundColor = 'var(--rose-500)';
        }
    }

    handleComplete() {
        this.setProcessingState(false);
        UINodes.statusText.textContent = "System Optimized";
        
        // Finalize sorting and data preparation
        this.dataStore.finalizeProcessing();
        
        // Update the top metric cards with animations
        this.updateMetricCards();
        
        // Render all beautiful charts
        AppState.chartManagerInstance.render(this.dataStore);
    }
    
    updateMetricCards() {
        const stats = this.dataStore.latestStats;
        
        // Animate numbers up to the final value (in TB) over 1000ms
        const totalTB = bytesToTB(stats.total);
        const usedTB = bytesToTB(stats.used);
        const availableTB = bytesToTB(stats.available);
        
        // Update static text limits 
        const prevTotal = parseFloat(UINodes.valTotal.textContent) || 0;
        const prevUsed = parseFloat(UINodes.valUsed.textContent) || 0;
        const prevFree = parseFloat(UINodes.valFree.textContent) || 0;

        animateValue(UINodes.valTotal, prevTotal, totalTB, 1200);
        animateValue(UINodes.valUsed, prevUsed, usedTB, 1200);
        animateValue(UINodes.valFree, prevFree, availableTB, 1200);
        
        if (stats.date) {
            const d = new Date(stats.date * 1000);
            UINodes.timeRange.textContent = `Latest snapshot from ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
        }
    }

    setProcessingState(isProcessing) {
        AppState.isProcessing = isProcessing;
        UINodes.btnFetch.disabled = isProcessing;
        
        if (isProcessing) {
            UINodes.statusDot.classList.add('scanning');
            UINodes.statusDot.style.backgroundColor = ''; // Revert to defined animated CSS
            UINodes.progressBar.style.width = '0%';
        } else {
            UINodes.statusDot.classList.remove('scanning');
            // Ensure animation finishes visually
            setTimeout(() => {
                UINodes.progressBar.style.width = '100%';
            }, 300);
        }
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    window.appFetcher = new DataFetcher();
});
