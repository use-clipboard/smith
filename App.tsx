

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import type { Transaction, FlaggedEntry, AppState, View, TargetSoftware, LedgerAccount, VTTransaction, CapiumTransaction, XeroTransaction, AppMode, BankCsvTransaction, Summary, LandlordExpenseTransaction, LandlordIncomeTransaction, ReviewPoint, WorkingPaper, JournalEntry, PerformanceReport, OutOfRangeDocument, ExportStatus, RiskAssessmentReport } from './types';
import { fileToBase64, readFileAsText, exportToCsv, parseLedgerCsv, findBestMatch, parseTrialBalance, compressImage } from './utils/fileUtils';
import { saveStateToLocalStorage, loadStateFromLocalStorage, clearStateFromLocalStorage } from './utils/localStorageUtils';
import FileUpload from './components/FileUpload';
import ResultsDisplay from './components/ResultsDisplay';
import Header from './components/Header';
import Spinner from './components/Spinner';
import ProcessingView from './components/ProcessingView';
import { CalculatorIcon, ErrorIcon, CheckCircleIcon, CloseIcon } from './components/Icons';
import ClientDetails from './components/ClientDetails';
import ModeSelectorScreen from './components/ModeSelectorScreen';
import BankToCsvResults from './components/BankToCsvResults';
import SummariseResults from './components/SummariseResults';
// FIX: Module '"file:///components/LandlordResults"' has no default export. Changed to named import.
import { LandlordResults } from './components/LandlordResults';
import FinalAccountsReviewResults from './components/FinalAccountsReviewResults';
import ApiKeyInstructions from './components/ApiKeyInstructions';
import PerformanceAnalysisResults from './components/PerformanceAnalysisResults';
import AskSmith from './components/AskSmith';
import FloatingAskSmith from './components/FloatingAskSmith';
import P32SummaryResults from './components/P32SummaryResults';
import GoogleAuthErrorScreen from './components/GoogleAuthErrorScreen';
import RiskAssessmentForm from './components/RiskAssessmentForm';
import { RISK_ASSESSMENT_QUESTIONS } from './components/RiskAssessmentForm';
import RiskAssessmentResults from './components/RiskAssessmentResults';
import PoliciesAndProcedures from './components/PoliciesAndProcedures';


// FIX: Add global declarations for Google APIs to satisfy TypeScript.
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const LANDLORD_INCOME_CATEGORY = "Total rents and other income from property";
// IMPORTANT: Replace with your actual Google Client ID from the Google Cloud Console.
// This is required for the Google Drive integration to work.
const GOOGLE_CLIENT_ID = '664773786883-r24mekuoee4jvi37jc3v135mf9grjk3k.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';


interface LandlordState {
    income: LandlordIncomeTransaction[];
    expenses: LandlordExpenseTransaction[];
    flagged: FlaggedEntry[];
}

const SoftwareSelector: React.FC<{ selected: TargetSoftware; onChange: (software: TargetSoftware) => void; }> = (props) => {
    const selected = props.selected;
    const onChange = props.onChange;
    return (
        <div className="mb-8">
            <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">2. Select Target Software</h3>
            <div className="flex flex-wrap justify-center gap-4">
                <button
                    onClick={() => onChange('vt')}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${selected === 'vt' ? 'bg-primary-600 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'}`}
                >
                    VT Transaction+
                </button>
                <button
                    onClick={() => onChange('capium')}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${selected === 'capium' ? 'bg-primary-600 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'}`}
                >
                    Capium Bookkeeping
                </button>
                <button
                    onClick={() => onChange('xero')}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${selected === 'xero' ? 'bg-primary-600 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'}`}
                >
                    Xero
                </button>
            </div>
        </div>
    );
};

export type SelectionChangeAction = { type: 'add'; index: number } | { type: 'remove'; index: number } | { type: 'all'; indices: number[] } | { type: 'clear' };
export type BatchUpdateField = 'primary' | 'analysis';

// FIX: Exported the App component as a named export to make it importable.
export const App: React.FC = () => {
    // =================================================================
    // 1. HOOKS (must be called unconditionally at the top level)
    // =================================================================
    const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem('gemini-api-key'));
    const [isChangingApiKey, setIsChangingApiKey] = useState<boolean>(false);
    const [appMode, setAppMode] = useState<AppMode>('selection');

    // Full Analysis State
    const [clientName, setClientName] = useState<string>('');
    const [clientAddress, setClientAddress] = useState<string>('');
    const [isVatRegistered, setIsVatRegistered] = useState<boolean>(false);
    const [pastTransactionsFile, setPastTransactionsFile] = useState<File | null>(null);
    const [ledgersFile, setLedgersFile] = useState<File | null>(null);
    const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
    const [transactionHistory, setTransactionHistory] = useState<(Transaction & { originalIndex?: number })[][]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [flaggedEntries, setFlaggedEntries] = useState<FlaggedEntry[]>([]);
    const [currentView, setCurrentView] = useState<View>('valid');
    const [targetSoftware, setTargetSoftware] = useState<TargetSoftware>('vt');
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    // Bank to CSV State
    const [bankCsvResults, setBankCsvResults] = useState<BankCsvTransaction[]>([]);

    // Summarise State
    const [summarisedDocuments, setSummarisedDocuments] = useState<OutOfRangeDocument[]>([]);


    // Landlord Analysis State
    const [landlordHistory, setLandlordHistory] = useState<LandlordState[]>([]);
    const [landlordHistoryIndex, setLandlordHistoryIndex] = useState<number>(-1);
    
    // Final Accounts Review State
    const [businessName, setBusinessName] = useState<string>('');
    const [clientCode, setClientCode] = useState<string>('');
    const [businessType, setBusinessType] = useState<'sole_trader' | 'partnership' | 'limited_company' | ''>('');
    const [periodStart, setPeriodStart] = useState<string>('');
    const [periodEnd, setPeriodEnd] = useState<string>('');
    const [isVatRegisteredReview, setIsVatRegisteredReview] = useState<boolean>(false);
    const [relevantContext, setRelevantContext] = useState<string>('');
    const [preparerName, setPreparerName] = useState<string>('');
    const [currentYearPL, setCurrentYearPL] = useState<File | null>(null);
    const [currentYearBS, setCurrentYearBS] = useState<File | null>(null);
    const [currentYearTB, setCurrentYearTB] = useState<File | null>(null);
    const [priorYearPL, setPriorYearPL] = useState<File | null>(null);
    const [priorYearBS, setPriorYearBS] = useState<File | null>(null);
    const [priorYearTB, setPriorYearTB] = useState<File | null>(null);
    const [reviewPoints, setReviewPoints] = useState<ReviewPoint[]>([]);
    const [workingPapersHistory, setWorkingPapersHistory] = useState<WorkingPaper[][]>([[]]);
    const [workingPapersHistoryIndex, setWorkingPapersHistoryIndex] = useState<number>(0);
    const [isGeneratingPapers, setIsGeneratingPapers] = useState<boolean>(false);

    // Performance Analysis State
    const [paBusinessName, setPaBusinessName] = useState<string>('');
    const [paManagementAccounts, setPaManagementAccounts] = useState<File[]>([]);
    const [paPriorAccounts, setPaPriorAccounts] = useState<File[]>([]);
    const [paPriorAnalysis, setPaPriorAnalysis] = useState<File[]>([]);
    const [paBusinessType, setPaBusinessType] = useState<'sole_trader' | 'partnership' | 'limited_company' | ''>('');
    const [paBusinessTrade, setPaBusinessTrade] = useState<string>('');
    const [paTradingLocation, setPaTradingLocation] = useState<string>('');
    const [paRelevantInfo, setPaRelevantInfo] = useState<string>('');
    const [paAnalysisPeriod, setPaAnalysisPeriod] = useState<'yearly' | 'quarterly' | 'monthly' | ''>('');
    const [paAnalysisPeriodDescription, setPaAnalysisPeriodDescription] = useState<string>('');
    const [performanceReport, setPerformanceReport] = useState<PerformanceReport>({ html: '', chartData: [] });

    // P32 Summary State
    const [p32Email, setP32Email] = useState<string>('');

    // Risk Assessment State
    const [raUsersName, setRaUsersName] = useState<string>('');
    const [raClientName, setRaClientName] = useState<string>('');
    const [raClientCode, setRaClientCode] = useState<string>('');
    const [raClientType, setRaClientType] = useState<'individual' | 'limited_company' | 'llp' | 'trust' | 'charity' | ''>('');
    const [raAnswers, setRaAnswers] = useState<Record<string, { answer: boolean, comment: string }>>({});
    const [riskAssessmentReport, setRiskAssessmentReport] = useState<RiskAssessmentReport | null>(null);

    // Common State
    const [documentFiles, setDocumentFiles] = useState<File[]>([]);
    const [documentPreviews, setDocumentPreviews] = useState<Map<string, string>>(new Map());
    const [appState, setAppState] = useState<AppState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [exportStatus, setExportStatus] = useState<ExportStatus>({ active: false, message: '', progress: 0 });
    
    // Google Drive State
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [isGoogleDriveConnected, setIsGoogleDriveConnected] = useState(false);
    const [authMessage, setAuthMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
    
    const progressIntervalRef = useRef<number | null>(null);
    
    const ai = useMemo(() => {
        if (!apiKey) return null;
        return new GoogleGenAI({ apiKey: apiKey });
    }, [apiKey]);
    
    const processedTransactions = transactionHistory[historyIndex] || [];
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < transactionHistory.length - 1;

    const currentLandlordState = landlordHistory[landlordHistoryIndex] || { income: [], expenses: [], flagged: [] };
    const { income: landlordIncome, expenses: landlordTransactions, flagged: flaggedLandlordEntries } = currentLandlordState;
    const canUndoLandlord = landlordHistoryIndex > 0;
    const canRedoLandlord = landlordHistoryIndex < landlordHistory.length - 1;

    const workingPapers = workingPapersHistory[workingPapersHistoryIndex] || [];
    const canUndoWorkingPapers = workingPapersHistoryIndex > 0;
    const canRedoWorkingPapers = workingPapersHistoryIndex < workingPapers.length - 1;
    
    const canProcess = useMemo(() => {
        if (appMode === 'final_accounts_review') {
            return !!(businessType && periodStart && periodEnd && currentYearPL && currentYearBS && currentYearTB);
        }
        if (appMode === 'performance_analysis') {
            return !!(paBusinessName && paManagementAccounts.length > 0 && paBusinessType && paBusinessTrade && paAnalysisPeriod);
        }
        if (appMode === 'risk_assessment') {
            return !!(raUsersName && raClientName && raClientType);
        }
        return documentFiles.length > 0;
    }, [appMode, documentFiles, businessType, periodStart, periodEnd, currentYearPL, currentYearBS, currentYearTB, paBusinessName, paManagementAccounts, paBusinessType, paBusinessTrade, paAnalysisPeriod, raUsersName, raClientName, raClientType]);


    // =================================================================
    // 2. HANDLERS & SIDE EFFECTS
    // =================================================================
    const handleResetApp = useCallback(() => {
        setAppMode('selection');
        setClientName('');
        setClientAddress('');
        setIsVatRegistered(false);
        setDocumentFiles([]);
        setDocumentPreviews(new Map());
        setPastTransactionsFile(null);
        setLedgersFile(null);
        setLedgerAccounts([]);
        setTransactionHistory([]);
        setHistoryIndex(-1);
        setFlaggedEntries([]);
        setCurrentView('valid');
        setTargetSoftware('vt');
        setSelectedIndices(new Set());
        setBankCsvResults([]);
        setSummarisedDocuments([]);
        setLandlordHistory([]);
        setLandlordHistoryIndex(-1);
        setBusinessName('');
        setClientCode('');
        setBusinessType('');
        setPeriodStart('');
        setPeriodEnd('');
        setIsVatRegisteredReview(false);
        setRelevantContext('');
        setPreparerName('');
        setCurrentYearPL(null);
        setCurrentYearBS(null);
        setCurrentYearTB(null);
        setPriorYearPL(null);
        setPriorYearBS(null);
        setPriorYearTB(null);
        setReviewPoints([]);
        setWorkingPapersHistory([[]]);
        setWorkingPapersHistoryIndex(0);
        setPaBusinessName('');
        setPaManagementAccounts([]);
        setPaPriorAccounts([]);
        setPaPriorAnalysis([]);
        setPaBusinessType('');
        setPaBusinessTrade('');
        setPaTradingLocation('');
        setPaRelevantInfo('');
        setPaAnalysisPeriod('');
        setPaAnalysisPeriodDescription('');
        setPerformanceReport({ html: '', chartData: [] });
        setP32Email('');
        setRiskAssessmentReport(null);
        setRaUsersName('');
        setRaClientName('');
        setRaClientCode('');
        setRaClientType('');
        setRaAnswers({});
        setAppState('idle');
        setError(null);
        setProgress(0);
        
        clearStateFromLocalStorage();
    }, []);

    const handleKeySubmit = useCallback((key: string) => {
        // Reset the entire application state to ensure a clean start.
        handleResetApp();

        localStorage.setItem('gemini-api-key', key);
        setApiKey(key);
        setIsChangingApiKey(false);
    }, [handleResetApp]);

    const handleChangeApiKey = useCallback(() => {
        setIsChangingApiKey(true);
    }, []);
    
    // Google Drive API Initialization & Redirect Handling
    useEffect(() => {
        const gapiScript = document.querySelector('script[src="https://apis.google.com/js/api.js"]') as HTMLScriptElement | null;
        const gisScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') as HTMLScriptElement | null;

        const initializeGapiClient = async () => {
            if (window.gapi) {
                await window.gapi.client.init({ discoveryDocs: [DRIVE_DISCOVERY_DOC] });
                const storedToken = localStorage.getItem('gdrive_token');
                if (storedToken) {
                    try {
                        const token = JSON.parse(storedToken);
                        if (token.created_at && Date.now() < token.created_at + (token.expires_in * 1000)) {
                            window.gapi.client.setToken(token);
                            setIsGoogleDriveConnected(true);
                        } else {
                            localStorage.removeItem('gdrive_token');
                        }
                    } catch (e) {
                        localStorage.removeItem('gdrive_token');
                    }
                }
            }
        };

        const gapiLoaded = () => {
            window.gapi.load('client', initializeGapiClient);
        };

        const gisLoaded = () => {
            // 1. Handle the redirect response FIRST
            let authRedirectHandled = false;
            if (window.location.hash && window.location.hash.includes('access_token')) {
                const params = new URLSearchParams(window.location.hash.substring(1));
                const accessToken = params.get('access_token');
                const expiresIn = params.get('expires_in');
                
                if (accessToken && expiresIn) {
                    authRedirectHandled = true;
                    const tokenResponse = {
                        access_token: accessToken,
                        expires_in: parseInt(expiresIn, 10),
                        created_at: Date.now()
                    };
                    localStorage.setItem('gdrive_token', JSON.stringify(tokenResponse));
                    if (window.gapi && window.gapi.client) {
                        window.gapi.client.setToken(tokenResponse);
                    }
                    setIsGoogleDriveConnected(true);
                    setAuthMessage({ type: 'success', text: 'Successfully connected to Google Drive!' });
                    setTimeout(() => setAuthMessage(null), 5000);
                }
            } else if (window.location.hash && window.location.hash.includes('error')) {
                authRedirectHandled = true;
                const params = new URLSearchParams(window.location.hash.substring(1));
                const error = params.get('error');
                console.error("Google Auth Error:", error, params.get('error_description'));
                let userFriendlyError = `Google Auth Error: ${error}.`;
                switch (error) {
                    case 'redirect_uri_mismatch':
                    case 'invalid_origin':
                        userFriendlyError = "Configuration Error: The application's URI is not authorized in your Google Cloud project.";
                        break;
                    case 'access_denied':
                        userFriendlyError = "Connection failed: You denied permission to access Google Drive. Please try again and grant permission to proceed.";
                        break;
                    case 'popup_closed_by_user': // This is less likely in redirect mode but good to have
                        userFriendlyError = "Connection cancelled: The sign-in window was closed before completion.";
                        break;
                    default:
                        userFriendlyError = `An unexpected error occurred during Google Drive connection: ${error}. Please try again.`;
                }
                setAuthMessage({ type: 'error', text: userFriendlyError });
            }

            // Clean the URL if we handled a redirect
            if (authRedirectHandled) {
                setTimeout(() => {
                    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
                }, 100);
            }
            
            // 2. Restore state after redirect (MUST run after token handling)
            const savedStateJSON = sessionStorage.getItem('googleAuthRedirectState');
            if (savedStateJSON) {
                try {
                    const savedState = JSON.parse(savedStateJSON);
                    setAppMode(savedState.appMode || 'selection');
                    setClientName(savedState.clientName || '');
                    setClientAddress(savedState.clientAddress || '');
                    setIsVatRegistered(savedState.isVatRegistered || false);
                    setTargetSoftware(savedState.targetSoftware || 'vt');
                    setBusinessName(savedState.businessName || '');
                    setClientCode(savedState.clientCode || '');
                    setBusinessType(savedState.businessType || '');
                    setPeriodStart(savedState.periodStart || '');
                    setPeriodEnd(savedState.periodEnd || '');
                    setIsVatRegisteredReview(savedState.isVatRegisteredReview || false);
                    setRelevantContext(savedState.relevantContext || '');
                    setPreparerName(savedState.preparerName || '');
                    setPaBusinessName(savedState.paBusinessName || '');
                    setPaBusinessType(savedState.paBusinessType || '');
                    setPaBusinessTrade(savedState.paBusinessTrade || '');
                    setPaTradingLocation(savedState.paTradingLocation || '');
                    setPaRelevantInfo(savedState.paRelevantInfo || '');
                    setPaAnalysisPeriod(savedState.paAnalysisPeriod || '');
                    setPaAnalysisPeriodDescription(savedState.paAnalysisPeriodDescription || '');
                    setP32Email(savedState.p32Email || '');
                    setRaUsersName(savedState.raUsersName || '');
                    setRaClientName(savedState.raClientName || '');
                    setRaClientCode(savedState.raClientCode || '');
                    setRaClientType(savedState.raClientType || '');
                    setRaAnswers(savedState.raAnswers || {});

                    // Give a moment for the state to apply before clearing the redirect message
                    if (authMessage && authMessage.type === 'info') {
                       setAuthMessage(null);
                    }

                } catch (e) {
                    console.error("Failed to restore state after Google auth redirect:", e);
                } finally {
                    sessionStorage.removeItem('googleAuthRedirectState');
                }
            }
            
            // 3. Initialize the client for future sign-ins
            if (window.google && window.google.accounts) {
                const client = window.google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: DRIVE_SCOPE,
                    ux_mode: 'redirect',
                    redirect_uri: window.location.origin + window.location.pathname,
                });
                setTokenClient(client);
            }
        };
        
        if (gapiScript) gapiScript.onload = gapiLoaded;
        if (gisScript) gisScript.onload = gisLoaded;

        // Check if already loaded
        if (window.gapi) gapiLoaded();
        if (window.google) gisLoaded();
    }, []); // Run only once on mount
    
    const handleGoogleSignIn = useCallback(() => {
        setAuthMessage(null);
        if (tokenClient) {
            const redirectState = {
                appMode, clientName, clientAddress, isVatRegistered, targetSoftware,
                businessName, clientCode, businessType, periodStart, periodEnd, isVatRegisteredReview,
                relevantContext, preparerName, paBusinessName, paBusinessType, paBusinessTrade,
                paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription,
                p32Email, raUsersName, raClientName, raClientCode, raClientType, raAnswers,
            };
            sessionStorage.setItem('googleAuthRedirectState', JSON.stringify(redirectState));
            
            setAuthMessage({ type: 'info', text: 'Redirecting to Google for authentication...' });

            tokenClient.requestAccessToken();
        } else {
             setAuthMessage({ type: 'error', text: "Google authentication is not ready. This can happen if the script is blocked by your browser or an extension (like an ad-blocker). Please check your connection, disable any ad-blockers for this site, and refresh the page." });
        }
    }, [
        tokenClient, appMode, clientName, clientAddress, isVatRegistered, targetSoftware,
        businessName, clientCode, businessType, periodStart, periodEnd, isVatRegisteredReview,
        relevantContext, preparerName, paBusinessName, paBusinessType, paBusinessTrade,
        paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription,
        p32Email, raUsersName, raClientName, raClientCode, raClientType, raAnswers,
    ]);

    const handleGoogleSignOut = useCallback(() => {
        const storedToken = localStorage.getItem('gdrive_token');
        if (storedToken) {
            try {
                const token = JSON.parse(storedToken);
                if (window.google && window.google.accounts) {
                    window.google.accounts.oauth2.revoke(token.access_token, () => {
                        console.log('Access token revoked.');
                    });
                }
            } catch (e) { console.error("Error parsing token for revoking:", e); }
        }
        localStorage.removeItem('gdrive_token');
        if (window.gapi && window.gapi.client) {
            window.gapi.client.setToken(null);
        }
        setIsGoogleDriveConnected(false);
    }, []);


    useEffect(() => {
        const loadedState = loadStateFromLocalStorage();
        if (loadedState && apiKey) { // Only load if a key is present
            console.log("Restoring session from localStorage...");
            setAppMode('full_analysis');
            setTargetSoftware(loadedState.targetSoftware);
            setClientName(loadedState.clientName || '');
            setClientAddress(loadedState.clientAddress || '');
            setIsVatRegistered(loadedState.isVatRegistered || false);
            setDocumentFiles(loadedState.documentFiles);
            setPastTransactionsFile(loadedState.pastTransactionsFile);
            setLedgersFile(loadedState.ledgersFile);
            setTransactionHistory(loadedState.transactionHistory);
            setHistoryIndex(loadedState.historyIndex);
            setFlaggedEntries(loadedState.flaggedEntries);
            setLedgerAccounts(loadedState.ledgerAccounts);
            setAppState(loadedState.appState);
            setCurrentView(loadedState.currentView);

            const newPreviews = new Map<string, string>();
            loadedState.documentFiles.forEach((file: File) => {
                newPreviews.set(file.name, URL.createObjectURL(file));
            });
            setDocumentPreviews(newPreviews);
        }
    }, [apiKey]); // Depend on apiKey to know when we can attempt to load state

    useEffect(() => {
        const saveState = async () => {
            if (appMode === 'full_analysis' && (appState === 'idle' || appState === 'success')) {
                await saveStateToLocalStorage({
                    appState: appState, clientName: clientName, clientAddress: clientAddress, isVatRegistered: isVatRegistered, documentFiles: documentFiles,
                    pastTransactionsFile: pastTransactionsFile, ledgersFile: ledgersFile, targetSoftware: targetSoftware, transactionHistory: transactionHistory,
                    historyIndex: historyIndex, flaggedEntries: flaggedEntries, ledgerAccounts: ledgerAccounts, currentView: currentView,
                });
            }
        };
        saveState().catch(console.error);
    }, [
        appMode, appState, clientName, clientAddress, isVatRegistered, documentFiles,
        pastTransactionsFile, ledgersFile, targetSoftware, transactionHistory,
        historyIndex, flaggedEntries, ledgerAccounts, currentView
    ]);

    useEffect(() => {
        document.body.classList.remove('theme-vt', 'theme-capium', 'theme-xero', 'theme-bank', 'theme-summarise', 'theme-landlord', 'theme-review', 'theme-performance', 'theme-p32', 'theme-ask-smith', 'theme-risk', 'theme-policies');
        let themeClass = 'theme-vt'; // Default theme
        switch (appMode) {
            case 'full_analysis':
                themeClass = `theme-${targetSoftware}`;
                break;
            case 'bank_to_csv':
                themeClass = 'theme-bank';
                break;
            case 'summarise':
                themeClass = 'theme-summarise';
                break;
            case 'landlord_analysis':
                themeClass = 'theme-landlord';
                break;
            case 'final_accounts_review':
                themeClass = 'theme-review';
                break;
            case 'performance_analysis':
                themeClass = 'theme-performance';
                break;
            case 'p32_summary':
                themeClass = 'theme-p32';
                break;
            case 'ask_smith':
                themeClass = 'theme-ask-smith';
                break;
            case 'risk_assessment':
                themeClass = 'theme-risk';
                break;
            case 'policies_and_procedures':
                themeClass = 'theme-policies';
                break;
        }
        document.body.classList.add(themeClass);
    }, [appMode, targetSoftware]);

    const handleSetDocuments = (files: File[]) => {
        documentPreviews.forEach(url => URL.revokeObjectURL(url));
        const newPreviews = new Map<string, string>();
        files.forEach(file => {
            newPreviews.set(file.name, URL.createObjectURL(file));
        });
        setDocumentPreviews(newPreviews);
        setDocumentFiles(files);
    };

    useEffect(() => {
        return () => {
            documentPreviews.forEach(url => URL.revokeObjectURL(url));
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [documentPreviews]);


    const commonFlaggedEntriesSchema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                fileName: { type: Type.STRING },
                reason: { type: Type.STRING },
                duplicateOf: { 
                    type: Type.STRING,
                    description: "Details of the potential duplicate transaction. Empty if not a duplicate."
                },
                pageNumber: { type: Type.NUMBER, description: "The page number (starting from 1) where this was found." },
                date: { type: Type.STRING, description: "The date from the document, if available. YYYY-MM-DD format." },
                supplier: { type: Type.STRING, description: "The supplier name, if available." },
                amount: { type: Type.NUMBER, description: "The total amount, if available." },
                description: { type: Type.STRING, description: "A brief description, if available." },
            },
            required: ['fileName', 'reason']
        }
    };

    const vtSchema = {
        type: Type.OBJECT,
        properties: {
            validTransactions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        pageNumber: { type: Type.NUMBER },
                        type: { type: Type.STRING },
                        refNo: { type: Type.STRING },
                        date: { type: Type.STRING },
                        primaryAccount: { type: Type.STRING },
                        details: { type: Type.STRING },
                        total: { type: Type.NUMBER },
                        vat: { type: Type.NUMBER },
                        analysis: { type: Type.NUMBER },
                        analysisAccount: { type: Type.STRING },
                        entryDetails: { type: Type.STRING },
                        transactionNotes: { type: Type.STRING },
                    },
                    required: ['fileName', 'pageNumber', 'type', 'refNo', 'date', 'primaryAccount', 'details', 'total', 'vat', 'analysis', 'analysisAccount', 'entryDetails', 'transactionNotes']
                }
            },
            flaggedEntries: commonFlaggedEntriesSchema
        }
    };

    const capiumSchema = {
        type: Type.OBJECT,
        properties: {
            validTransactions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        pageNumber: { type: Type.NUMBER },
                        contactname: { type: Type.STRING },
                        contacttype: { type: Type.STRING },
                        reference: { type: Type.STRING },
                        description: { type: Type.STRING },
                        accountname: { type: Type.STRING },
                        accountcode: { type: Type.STRING },
                        invoicedate: { type: Type.STRING },
                        vatname: { type: Type.STRING },
                        vatamount: { type: Type.NUMBER },
                        isvatincluded: { type: Type.STRING },
                        amount: { type: Type.NUMBER },
                        netAmount: { type: Type.NUMBER },
                        paydate: { type: Type.STRING },
                        payaccountname: { type: Type.STRING },
                        payaccountcode: { type: Type.STRING },
                    },
                    required: ['fileName', 'pageNumber', 'contactname', 'contacttype', 'reference', 'description', 'accountname', 'accountcode', 'invoicedate', 'vatname', 'vatamount', 'isvatincluded', 'amount', 'netAmount']
                }
            },
             flaggedEntries: commonFlaggedEntriesSchema
        }
    };

    const xeroSchema = {
        type: Type.OBJECT,
        properties: {
            validTransactions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        pageNumber: { type: Type.NUMBER },
                        contactName: { type: Type.STRING },
                        invoiceNumber: { type: Type.STRING },
                        invoiceDate: { type: Type.STRING },
                        dueDate: { type: Type.STRING },
                        description: { type: Type.STRING },
                        quantity: { type: Type.NUMBER },
                        unitAmount: { type: Type.NUMBER },
                        grossAmount: { type: Type.NUMBER },
                        accountCode: { type: Type.STRING },
                        accountName: { type: Type.STRING },
                        taxType: { type: Type.STRING },
                    },
                    required: ['fileName', 'pageNumber', 'contactName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'description', 'quantity', 'unitAmount', 'grossAmount', 'accountCode', 'accountName', 'taxType']
                }
            },
            flaggedEntries: commonFlaggedEntriesSchema
        }
    };
    
    const bankToCsvSchema = {
        type: Type.OBJECT,
        properties: {
            transactions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        Date: { type: Type.STRING, description: "Date in YYYY-MM-DD format." },
                        Description: { type: Type.STRING },
                        "Money In": { type: Type.NUMBER, description: "Use null if not applicable." },
                        "Money Out": { type: Type.NUMBER, description: "Use null if not applicable." },
                        Balance: { type: Type.NUMBER, description: "Use null if not applicable." },
                        suggestedLedgerAccount: { type: Type.STRING, description: "Based on the description, suggest the most likely ledger account name using standard UK bookkeeping names (e.g., 'Sales', 'Motor Expenses', 'Telephone')." },
                    },
                    required: ['Date', 'Description', 'suggestedLedgerAccount']
                }
            }
        }
    };
    
    const summariseSchema = {
        type: Type.OBJECT,
        properties: {
            documents: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        detectedDate: { type: Type.STRING, description: "The relevant service period date found in the document, in YYYY-MM-DD format." },
                        entityName: { type: Type.STRING, description: "The name of the supplier or customer." },
                        detailedCategory: { type: Type.STRING, description: "A detailed accounting category based on UK accounting principles." },
                        totalNetAmount: { type: Type.NUMBER, description: "The total net amount. Use 0 if not applicable." },
                        totalVatAmount: { type: Type.NUMBER, description: "The total VAT amount. Use 0 if not applicable." },
                        totalGrossAmount: { type: Type.NUMBER, description: "The total gross amount." },
                    },
                    required: ['fileName', 'detectedDate', 'entityName', 'detailedCategory', 'totalGrossAmount']
                }
            }
        }
    };

    const landlordAnalysisSchema = {
        type: Type.OBJECT,
        properties: {
            income: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        Date: { type: Type.STRING, description: "The date of the income transaction, in YYYY-MM-DD format." },
                        PropertyAddress: { type: Type.STRING },
                        Description: { type: Type.STRING },
                        Category: { type: Type.STRING, description: "This MUST be 'Total rents and other income from property'." },
                        Amount: { type: Type.NUMBER, description: "The total gross amount of the income." },
                    },
                    required: ['fileName', 'Date', 'PropertyAddress', 'Description', 'Category', 'Amount']
                }
            },
            expenses: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        DueDate: { type: Type.STRING, description: "The invoice date, in YYYY-MM-DD format." },
                        Description: { type: Type.STRING },
                        Category: { type: Type.STRING },
                        Amount: { type: Type.NUMBER, description: "The total gross amount of the expense." },
                        Supplier: { type: Type.STRING },
                        TenantPayable: { type: Type.BOOLEAN, description: "Is this expense to be recharged to a tenant?" },
                        CapitalExpense: { type: Type.BOOLEAN, description: "Is this a capital expense (e.g., an improvement) rather than a repair?" },
                        PropertyAddress: { type: Type.STRING, description: "The address of the rental property this expense relates to. If not found, use 'No Address'." },
                    },
                    required: ['fileName', 'DueDate', 'Description', 'Category', 'Amount', 'Supplier', 'TenantPayable', 'CapitalExpense', 'PropertyAddress']
                }
            },
            flaggedEntries: {
                 type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        fileName: { type: Type.STRING },
                        reason: { type: Type.STRING },
                        duplicateOf: { type: Type.STRING, description: "Details of the potential duplicate transaction. Empty if not a duplicate." },
                        pageNumber: { type: Type.NUMBER },
                        date: { type: Type.STRING },
                        supplier: { type: Type.STRING },
                        amount: { type: Type.NUMBER },
                        description: { type: Type.STRING },
                        PropertyAddress: { type: Type.STRING, description: "The property address if available, otherwise 'No Address'." },
                    },
                    required: ['fileName', 'reason']
                }
            }
        }
    };

    const finalAccountsReviewSchema = {
        type: Type.OBJECT,
        properties: {
            reviewPoints: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        area: { type: Type.STRING, description: "e.g., 'Balance Sheet', 'P&L', 'Compliance'" },
                        issue: { type: Type.STRING, description: "e.g., 'Negative Cash Balance'" },
                        explanation: { type: Type.STRING, description: "Detailed explanation of the issue." },
                        severity: { type: Type.STRING, description: "Must be 'Serious' or 'Minor'."},
                        suggestedJournal: {
                            type: Type.OBJECT,
                            properties: {
                                debitAccount: { type: Type.STRING },
                                creditAccount: { type: Type.STRING },
                                amount: { type: Type.NUMBER },
                                description: { type: Type.STRING },
                            },
                            required: ['debitAccount', 'creditAccount', 'amount', 'description']
                        }
                    },
                     required: ['area', 'issue', 'explanation', 'severity']
                }
            }
        }
    };

    const workingPapersSchema = {
        type: Type.OBJECT,
        properties: {
            workingPapers: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "The working paper reference and title, e.g., 'A1 - Notes for the principal'" },
                        content: { type: Type.STRING, description: "Plain text, well-formatted content for the working paper section." }
                    },
                    required: ['title', 'content']
                }
            }
        }
    };
    
    const performanceAnalysisSchema = {
        type: Type.OBJECT,
        properties: {
            reportHtml: {
                type: Type.STRING,
                description: "The full business performance report formatted as clean, well-structured HTML."
            },
            chartDataJson: {
                type: Type.STRING,
                description: "A JSON string representing an array of data for bar charts. e.g., '[{\"label\": \"KPI Name\", \"company\": 25, \"benchmark\": 22}]'"
            }
        }
    };

    const p32SummarySchema = {
        type: Type.OBJECT,
        properties: {
            emailBody: {
                type: Type.STRING,
                description: "The full, client-ready email body text. Use double line breaks for paragraphs."
            }
        }
    };

    const riskAssessmentSchema = {
        type: Type.OBJECT,
        properties: {
            overallRiskLevel: { type: Type.STRING, description: "The overall risk level, must be one of 'Low', 'Medium', or 'High'." },
            riskJustification: { type: Type.STRING, description: "A detailed paragraph explaining the reasoning for the assigned risk level, referencing specific high-risk answers." },
            summaryOfAnswers: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        questionId: { type: Type.STRING, description: "The unique ID of the question, e.g., 'q1'." },
                        question: { type: Type.STRING },
                        answer: { type: Type.STRING, description: "Must be 'Yes' or 'No'." },
                        userComment: { type: Type.STRING, description: "The comment provided by the user. Should be an empty string if no comment was made." }
                    },
                    required: ['questionId', 'question', 'answer', 'userComment']
                }
            },
            suggestedControls: { type: Type.STRING, description: "A plain text, well-formatted section detailing specific, actionable controls to mitigate the identified risks. Use double line breaks for paragraphs." },
            trainingSuggestions: { type: Type.STRING, description: "A plain text, well-formatted section suggesting relevant training topics for the firm's staff. Use double line breaks for paragraphs." }
        },
        required: ['overallRiskLevel', 'riskJustification', 'summaryOfAnswers', 'suggestedControls', 'trainingSuggestions']
    };


    const prepareAndProcess = useCallback(async (prompt: string, schema: any, files?: File[]) => {
        if (!ai) {
            setError("Google AI client is not initialized. Please check your API key.");
            setAppState('error');
            return;
        }

        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        
        const filesToProcess = files || documentFiles;
        const fileCount = filesToProcess.length;
        const estimatedDurationMs = (5 + fileCount * 2) * 1000;
        let elapsedTimeMs = 0;
        const intervalStepMs = 100;

        progressIntervalRef.current = window.setInterval(() => {
            elapsedTimeMs += intervalStepMs;
            setProgress(Math.min(99, (elapsedTimeMs / estimatedDurationMs) * 100));
        }, intervalStepMs);

        try {
            const documentParts = await Promise.all(
                filesToProcess.map(async (file) => ({
                    inlineData: { mimeType: file.type, data: await fileToBase64(file) },
                }))
            );

            const textPart = { text: prompt };
            const allParts = [].concat(documentParts, [textPart]);

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: { parts: allParts },
                config: { responseMimeType: "application/json", responseSchema: schema }
            });

            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            setProgress(100);

            let jsonText = response.text.trim();
            if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
            if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();
            
            await new Promise(resolve => setTimeout(resolve, 500));
            setAppState('success');
            return JSON.parse(jsonText);

        } catch (err) {
            console.error(err);
            if (err instanceof Error && err.message.includes("document has no pages")) {
                setError("One of the uploaded documents appears to be empty or corrupted. Please check your files and try again.");
            } else {
                setError(err instanceof Error ? err.message : "An unknown error occurred during processing.");
            }
            setAppState('error');
            setProgress(0);
        } finally {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        }
    }, [documentFiles, ai]);
    
    const handleProcessFullAnalysis = useCallback(async () => {
        const pastTransactionsContent = pastTransactionsFile ? await readFileAsText(pastTransactionsFile) : null;
        const ledgersContent = ledgersFile ? await readFileAsText(ledgersFile) : null;
        
        let parsedLedgerAccounts: LedgerAccount[] = [];
        if (ledgersContent) {
            parsedLedgerAccounts = parseLedgerCsv(ledgersContent);
            setLedgerAccounts(parsedLedgerAccounts);
        }
        
        const fileNames = documentFiles.map(f => f.name);

        let clientInfoPrompt = '';
        if (clientName.trim()) {
            clientInfoPrompt += `\n**Client Information for Context:**\nThe client is "${clientName.trim()}", address: "${clientAddress.trim()}".`;
            clientInfoPrompt += `\n**Critical Instructions based on Client Info:**\n- A document is a **purchase** if addressed TO the client. Use type 'PIN'.\n- A document is a **sale** if issued BY the client. Use type 'SIN'.\n- If addressed to a different entity, flag it as "Potentially irrelevant".\n- If unsure, flag as "Uncertain transaction type".`;
        }

        const vatInstructionPrompt = isVatRegistered
            ? `\n**VAT Status: REGISTERED.**\n- You MUST only extract a VAT amount if a VAT value (e.g., "VAT", "Value Added Tax") and a corresponding amount is explicitly listed on the document.\n- If the document does not explicitly state a VAT amount, the VAT value MUST be 0.\n- If a VAT registration number is present, it is a strong indicator that VAT might be applicable, but you still must find an explicit VAT amount on the document to extract it.`
            : `\n**VAT Status: NOT REGISTERED.**\n- The client is NOT VAT registered. For ALL transactions, the VAT amount MUST be 0.`;

        let basePrompt = `
            You are an expert UK bookkeeper. Analyze documents with filenames: [${fileNames.join(', ')}].
            
            **CRITICAL INSTRUCTIONS:**
            1.  You MUST process every single document provided. Each document must result in an entry in either the 'validTransactions' array OR the 'flaggedEntries' array. Do not omit any document from the final JSON output.
            2.  For the 'fileName' field in your response, you MUST use the exact filename from the provided list: [${fileNames.join(', ')}].
            3.  For each transaction or flagged entry, you MUST identify the page number (starting from 1) in the source document where it was found.

            ${clientInfoPrompt}
            ${vatInstructionPrompt}
            Your task is to perform these two steps for all documents: 1) Extract valid transactions. 2) Identify and flag problematic entries.
        `;

        if (pastTransactionsContent) basePrompt += `\nPast transactions for context:\n---\n${pastTransactionsContent}\n---`;
        if (ledgersContent) basePrompt += `\nChart of accounts to use:\n---\n${ledgersContent}\n---`;
            
        let taskPrompt = '';
        const currencyAndDescriptionInstruction = `
**Description Formatting:**
The main description field ('details'/'entryDetails' for VT+, 'description' for others) MUST be formatted as: "[Invoice Number] - [Supplier/Customer Name] - [Short Description] - [Service Period]".
- [Short Description]: A 1-2 word summary of the invoice's content (e.g., "Rent", "Office Supplies").
- [Service Period]: The date range if specified (e.g., "Rent 31/03/25-30/06/25"). Omit if not present.

**Currency Conversion:**
- If an invoice is not in GBP (£), you MUST convert ALL money values to GBP.
- Use the historical exchange rate for the currency to GBP on the invoice's date.
- ALL monetary fields in the final JSON output (total, vat, net, etc.) MUST be in GBP.
- If a conversion was performed, you MUST append the exchange rate used to the end of the description field in the format " (FX Rate: [value] [CUR]/GBP)". For example: "... (FX Rate: 1.18 EUR/GBP)".
`;

        if (targetSoftware === 'vt') {
             taskPrompt = `**Task 1: Valid transactions (VT Transaction+ Format)**\nRules: 'type' is PIN/SIN/PAY/REC/PCR. 'refNo' is "[auto]". 'date' is YYYY-MM-DD. 'primaryAccount' is the supplier/customer name. 'total' is the invoice's total GROSS amount. 'vat' is the invoice's total VAT amount. 'analysis' is the invoice's total NET amount. 'analysisAccount' MUST match the provided chart of accounts or be flagged. 'transactionNotes' is empty. Each document should result in a single transaction representing the invoice totals. ${currencyAndDescriptionInstruction} ${isVatRegistered ? '' : "CRITICAL: 'vat' MUST be 0 and 'analysis' MUST equal 'total'."}`;
        } else if (targetSoftware === 'capium') {
            taskPrompt = `**Task 1: Valid Transactions (Capium Format)**\nRules: 'contacttype' is Supplier/Customer. 'invoicedate' is YYYY-MM-DD. 'accountname'/'accountcode' from chart of accounts. 'isvatincluded' is "Yes". 'amount' is the invoice's total GROSS amount. 'vatamount' is the total VAT. 'netAmount' is the total NET amount. For unpaid purchase invoices, leave 'paydate', 'payaccountname', 'payaccountcode' blank. ${currencyAndDescriptionInstruction} ${isVatRegistered ? '' : "CRITICAL: 'vatamount' MUST be 0."}`;
        } else { // xero
             taskPrompt = `**Task 1: Valid Transactions (Xero Bills Format)**\nRules: Format for single-line bills. Flag sales docs. 'invoiceNumber' is mandatory. 'dueDate' is invoiceDate + 30 days if not specified. 'quantity' is 1. 'unitAmount' is the invoice's NET amount. 'grossAmount' is the invoice's total GROSS amount. 'accountCode' from chart of accounts. ${currencyAndDescriptionInstruction} ${isVatRegistered ? '`taxType` must be chosen from "20% (VAT on Expenses)", "5% (VAT on Expenses)", "Zero Rated Expenses", or "Exempt Expenses". If no VAT amount is explicitly stated on the document, you MUST use "No VAT" or "Exempt Expenses".' : 'CRITICAL: `unitAmount` MUST be the GROSS value (and therefore `grossAmount` must be the same value) and `taxType` MUST be "No VAT" or "Exempt Expenses".'}`;
        }

        let flaggingPrompt = `**Task 2: Flagging Entries**\nFlag irrelevant, unprocessable, or potential duplicate documents. Include the page number where the flagged item was found.`;
        if (pastTransactionsContent) {
            flaggingPrompt += ` A duplicate is primarily identified by a matching **Invoice Number** from a past transaction. Also consider matches with the same supplier, a date within 7 days, and a total within £1.00. If found, reason is "Potential duplicate transaction." and 'duplicateOf' field must detail the matched transaction.`;
        } else {
             flaggingPrompt += ` Check for duplicates within the current upload set only, primarily using the Invoice Number.`;
        }
        
        flaggingPrompt += ` When checking for duplicates within the current batch, if you find multiple identical documents, you MUST process the first occurrence as a valid transaction and flag all subsequent occurrences as duplicates.`;
        
        const fullPrompt = basePrompt + taskPrompt + flaggingPrompt + `\nReturn a single JSON object with keys: 'validTransactions' and 'flaggedEntries'.`;
        const schema = targetSoftware === 'vt' ? vtSchema : targetSoftware === 'capium' ? capiumSchema : xeroSchema;
        
        const jsonResponse = await prepareAndProcess(fullPrompt, schema);
        if (!jsonResponse) return;

        const rawTransactions = (jsonResponse.validTransactions || []).filter(Boolean);
        const rawFlagged = (jsonResponse.flaggedEntries || []).filter(Boolean);

        const calculationFlagged: FlaggedEntry[] = [];
        const transactionsForValidation: Transaction[] = [];
        const TOLERANCE = 0.01; // Allow for rounding differences up to 1p

        rawTransactions.forEach((tx: any) => { // Use 'any' to access new schema properties
            let isValid = true;
            let net = 0, vat = 0, gross = 0;
            let reason = '';

            try {
                if (targetSoftware === 'vt') {
                    const vtTx = tx as VTTransaction;
                    net = vtTx.analysis || 0;
                    vat = vtTx.vat || 0;
                    gross = vtTx.total || 0;
                    if (Math.abs((net + vat) - gross) > TOLERANCE) {
                        isValid = false;
                        reason = `Calculation error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) = ${(net + vat).toFixed(2)}, which does not equal Gross (${gross.toFixed(2)}).`;
                    }
                } else if (targetSoftware === 'capium') {
                    const capiumTx = tx as CapiumTransaction & { netAmount: number };
                    net = capiumTx.netAmount || 0;
                    vat = capiumTx.vatamount || 0;
                    gross = capiumTx.amount || 0;
                    if (Math.abs((net + vat) - gross) > TOLERANCE) {
                        isValid = false;
                        reason = `Calculation error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) = ${(net + vat).toFixed(2)}, which does not equal Gross (${gross.toFixed(2)}).`;
                    }
                } else if (targetSoftware === 'xero') {
                    const xeroTx = tx as XeroTransaction & { grossAmount: number };
                    net = xeroTx.unitAmount || 0;
                    gross = xeroTx.grossAmount || 0;
                    const taxType = xeroTx.taxType || '';
                    let vatRate = 0;

                    if (taxType.includes('20%')) {
                        vatRate = 0.20;
                    } else if (taxType.includes('5%')) {
                        vatRate = 0.05;
                    }
                    
                    const calculatedVat = net * vatRate;

                    if (!isVatRegistered) {
                        // For non-VAT, unitAmount is gross, vat is 0.
                        if (Math.abs(net - gross) > TOLERANCE) {
                            isValid = false;
                            reason = `Calculation error (non-VAT): Net/Gross value from 'unitAmount' (${net.toFixed(2)}) does not match total 'grossAmount' (${gross.toFixed(2)}).`;
                        }
                    } else {
                        // For VAT registered, unitAmount is net.
                        if (Math.abs((net + calculatedVat) - gross) > TOLERANCE) {
                            isValid = false;
                            reason = `Calculation error: Net (${net.toFixed(2)}) + Calculated VAT (${calculatedVat.toFixed(2)}) = ${(net + calculatedVat).toFixed(2)}, which does not equal Gross from AI (${gross.toFixed(2)}).`;
                        }
                    }
                }
            } catch (e) {
                isValid = false;
                reason = `Missing data for calculation check.`;
                gross = (tx as any).total || (tx as any).amount || (tx as any).grossAmount || (tx as any).unitAmount || 0;
            }

            if (isValid) {
                transactionsForValidation.push(tx as Transaction);
            } else {
                calculationFlagged.push({
                    fileName: tx.fileName,
                    reason: reason,
                    pageNumber: tx.pageNumber,
                    date: tx.date || tx.invoicedate || tx.invoiceDate,
                    supplier: tx.primaryAccount || tx.contactname || tx.contactName,
                    amount: gross,
                    description: tx.details || tx.description,
                    transactionData: tx as Transaction,
                });
            }
        });


        let validatedTransactions = transactionsForValidation.map((tx: Transaction) => {
            if (parsedLedgerAccounts.length > 0) {
                const aiAccountName = targetSoftware === 'vt' ? (tx as VTTransaction).analysisAccount : targetSoftware === 'capium' ? (tx as CapiumTransaction).accountname : (tx as XeroTransaction).accountName;
                const originalAiSuggestion = { name: aiAccountName };

                const perfectMatch = parsedLedgerAccounts.find(acc => acc.name.toLowerCase() === aiAccountName.toLowerCase());
                if (perfectMatch) {
                    return Object.assign({}, tx, { ledgerValidation: { status: 'perfect', originalAiSuggestion: originalAiSuggestion } });
                }

                const matchResult = findBestMatch(aiAccountName, parsedLedgerAccounts);
                const bestMatch = matchResult.bestMatch;
                const score = matchResult.score;
                if (bestMatch && score > 0.7) {
                    const updatedTx = Object.assign({}, tx);
                    if (targetSoftware === 'vt') (updatedTx as VTTransaction).analysisAccount = bestMatch.name;
                    if (targetSoftware === 'capium') { (updatedTx as CapiumTransaction).accountname = bestMatch.name; (updatedTx as CapiumTransaction).accountcode = bestMatch.code || ''; }
                    if (targetSoftware === 'xero') { (updatedTx as XeroTransaction).accountName = bestMatch.name; (updatedTx as XeroTransaction).accountCode = bestMatch.code || ''; }
                    return Object.assign({}, updatedTx, { ledgerValidation: { status: 'suggestion', originalAiSuggestion: originalAiSuggestion, suggestedLedger: bestMatch } });
                }
                return Object.assign({}, tx, { ledgerValidation: { status: 'no-match', originalAiSuggestion: originalAiSuggestion } });
            }
            return tx;
        });

        setTransactionHistory([validatedTransactions]);
        setHistoryIndex(0);
        setFlaggedEntries([...rawFlagged, ...calculationFlagged]);
    }, [documentFiles, pastTransactionsFile, ledgersFile, targetSoftware, clientName, clientAddress, isVatRegistered, prepareAndProcess]);

    const handleProcessBankAnalyser = useCallback(async () => {
        const ledgersContent = ledgersFile ? await readFileAsText(ledgersFile) : null;
        let parsedLedgerAccounts: LedgerAccount[] = [];
        if (ledgersContent) {
            parsedLedgerAccounts = parseLedgerCsv(ledgersContent);
            setLedgerAccounts(parsedLedgerAccounts);
        }

        let prompt = `You are an expert UK bookkeeper. Your task is to analyze the provided bank statement document(s) and accurately extract all transactions. 
        For each transaction, you must perform two tasks:
        1.  Extract the transaction details: 'Date' (YYYY-MM-DD), 'Description', 'Money In' (number, null if not applicable), 'Money Out' (number, null if not applicable), and 'Balance' (number, null if not applicable).
        2.  Based on the transaction 'Description', suggest the most appropriate nominal ledger account.`;
        
        if (ledgersContent) {
            prompt += `\nYou MUST select an account name from this provided Chart of Accounts:\n---\n${ledgersContent}\n---`;
        } else {
            prompt += `\nYou should use standard UK bookkeeping account names (e.g., "Sales", "Motor Expenses", "Telephone", "Bank Charges").`;
        }

        prompt += `\nReturn a single JSON object with one key: 'transactions', containing an array of the transaction objects including your suggested ledger account.`;
        
        const jsonResponse = await prepareAndProcess(prompt, bankToCsvSchema);
        if (jsonResponse) {
             let validatedTransactions = (jsonResponse.transactions || []).filter(Boolean).map((tx: BankCsvTransaction) => {
                if (parsedLedgerAccounts.length > 0) {
                    const aiAccountName = tx.suggestedLedgerAccount;
                    const originalAiSuggestion = { name: aiAccountName };

                    const perfectMatch = parsedLedgerAccounts.find(acc => acc.name.toLowerCase() === aiAccountName.toLowerCase());
                    if (perfectMatch) {
                        return { ...tx, ledgerValidation: { status: 'perfect', originalAiSuggestion } };
                    }

                    const matchResult = findBestMatch(aiAccountName, parsedLedgerAccounts);
                    if (matchResult.bestMatch && matchResult.score > 0.7) {
                        return { ...tx, suggestedLedgerAccount: matchResult.bestMatch.name, ledgerValidation: { status: 'suggestion', originalAiSuggestion, suggestedLedger: matchResult.bestMatch } };
                    }
                    return { ...tx, ledgerValidation: { status: 'no-match', originalAiSuggestion } };
                }
                return { ...tx, ledgerValidation: { status: 'unvalidated', originalAiSuggestion: { name: tx.suggestedLedgerAccount } } };
            });
            setBankCsvResults(validatedTransactions);
        }
    }, [prepareAndProcess, ledgersFile]);

    const handleProcessSummarise = useCallback(async () => {
        const prompt = `You are an expert UK bookkeeper. Analyze the provided financial documents.
    
        **Primary Goal:** For EACH document, extract its details into a structured object.

        **Intelligent Date Analysis**
        For each document, you MUST determine its **relevant service date or period**. This is not just the invoice date.
        - Look for phrases like "for the period...", "services rendered in...", "rent for month of...".
        - If a service period is found (e.g., "November 2025"), use a representative date from that period (e.g., "2025-11-01").
        - If no service period is found, use the main invoice date.
        - The final determined relevant date for each document MUST be in YYYY-MM-DD format and assigned to the 'detectedDate' field.

        **Output Generation**
        Return a single JSON object with ONE key: 'documents'.
        The 'documents' key should contain a flat array where each object represents a single document you analyzed. Each object in the array must contain:
        - 'fileName': The name of the source file.
        - 'detectedDate': The relevant date you determined, in YYYY-MM-DD format.
        - 'entityName': The name of the supplier or customer.
        - 'detailedCategory': A detailed accounting category (e.g., 'Expense - Electricity', 'Income - Sales').
        - 'totalNetAmount': The total net amount. Use 0 if not applicable.
        - 'totalVatAmount': The total VAT amount. Use 0 if not applicable.
        - 'totalGrossAmount': The total gross amount.
        `;

        const jsonResponse = await prepareAndProcess(prompt, summariseSchema);
        if (jsonResponse) {
            setSummarisedDocuments((jsonResponse.documents || []).filter(Boolean));
        }
    }, [prepareAndProcess]);

    const handleProcessLandlordAnalysis = useCallback(async () => {
        const categories = [
            "Allowable loan interest and other financial costs",
            "Car, van and other travel expenses",
            "Costs of services provided, including wages",
            "Legal, management and other professional fees",
            "Other allowable property expenses",
            "Property repairs and maintenance",
            "Rent, rates, insurance, ground rents"
        ];
        const prompt = `You are an expert UK bookkeeper for landlords. Your task is to analyze the provided documents which could be expense receipts, invoices, OR landlord statements from letting agents.
        
        Your goal is to extract both INCOME and EXPENSE transactions and flag anything irrelevant.

        **Task 1: Extract Income Transactions**
        - Look for landlord statements from letting agents or other evidence of rental income.
        - For each income transaction, extract:
            1.  **Date**: The payment or statement date. Format as YYYY-MM-DD.
            2.  **PropertyAddress**: The address of the rental property.
            3.  **Description**: A concise summary, e.g., "Rent for April 2024". Also include any service period found (e.g., "Rent for Jan-Mar 2024").
            4.  **Category**: This MUST be the exact string "Total rents and other income from property".
            5.  **Amount**: The total gross income received.
        - Populate the 'income' array with these objects.

        **Task 2: Extract Expense Transactions**
        - Look for invoices and receipts for property-related expenses.
        - For each expense transaction, extract:
            1.  **DueDate**: The main date on the invoice/receipt. Format as YYYY-MM-DD.
            2.  **Description**: A concise summary of the expense. Also include any service period found (e.g., "Services for Oct-Dec 2024").
            3.  **Category**: You MUST assign one of the following exact categories: [${categories.join(', ')}].
            4.  **Amount**: The total gross amount of the expense.
            5.  **Supplier**: The name of the supplier.
            6.  **TenantPayable**: Set to \`true\` if the cost is to be recharged to a tenant, otherwise \`false\`.
            7.  **CapitalExpense**: Set to \`true\` if it is an improvement (capital), \`false\` if it is a repair/maintenance.
            8.  **PropertyAddress**: The address of the rental property this expense relates to. First, look for an address in the document's description. If not found, use the address the document is made out to. If no address can be found anywhere, you MUST use the string "No Address".
        - Populate the 'expenses' array with these objects.

        **Task 3: Flagging Rules:**
        - If a document is clearly not property-related (e.g., a personal shopping receipt), you MUST flag it.
        - When flagging an entry, you MUST still attempt to extract and include the 'date', 'supplier', 'amount', 'description', and 'PropertyAddress' (if available, otherwise "No Address") in the flagged entry object.

        Return a single JSON object with three keys: 'income', 'expenses', and 'flaggedEntries'.
        `;
        
        const jsonResponse = await prepareAndProcess(prompt, landlordAnalysisSchema);
        if (!jsonResponse || !ai) return;

        // --- START: AI-POWERED ADDRESS GROUPING ---
        const allAddresses = [
            ...((jsonResponse.income || []).map((t: LandlordIncomeTransaction) => t.PropertyAddress)),
            ...((jsonResponse.expenses || []).map((t: LandlordExpenseTransaction) => t.PropertyAddress))
        ].filter(Boolean);

        const uniqueAddresses = [...new Set(allAddresses)];

        let finalIncome = (jsonResponse.income || []).filter(Boolean);
        let finalExpenses = (jsonResponse.expenses || []).filter(Boolean);

        if (uniqueAddresses.length > 1) {
            try {
                const groupingPrompt = `You are an address normalization expert. The following is a list of property addresses extracted from documents: ${JSON.stringify(uniqueAddresses)}.
                Your task is to group these addresses by similarity, correcting typos and standardizing abbreviations (e.g., 'Rd' to 'Road'). For each group, choose the most complete and best-spelled version as the canonical address.
                Return a single JSON object with a key 'addressMap', where each key is an original address from the input list, and its value is the canonical address for its group.
                Example: If the input is ["10 Glen Rd", "10 Glenn Road"], the output for 'addressMap' should be {"10 Glen Rd": "10 Glenn Road", "10 Glenn Road": "10 Glenn Road"}. The value for "No Address" must always be "No Address".`;

                const addressGroupingSchema = {
                    type: Type.OBJECT,
                    properties: {
                        addressMap: {
                            type: Type.OBJECT,
                            description: "An object where each key is an original address from the input list, and its value is the canonical address for its group."
                        }
                    }
                };

                const groupingResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: { parts: [{ text: groupingPrompt }] },
                    config: { responseMimeType: "application/json", responseSchema: addressGroupingSchema }
                });
                
                let groupingJsonText = groupingResponse.text.trim();
                const groupingResult = JSON.parse(groupingJsonText);

                if (groupingResult.addressMap) {
                    const addressMap = groupingResult.addressMap;
                    finalIncome = finalIncome.map((tx: LandlordIncomeTransaction) => ({ ...tx, PropertyAddress: addressMap[tx.PropertyAddress] || tx.PropertyAddress }));
                    finalExpenses = finalExpenses.map((tx: LandlordExpenseTransaction) => ({ ...tx, PropertyAddress: addressMap[tx.PropertyAddress] || tx.PropertyAddress }));
                }

            } catch (groupingError) {
                console.error("Failed to group property addresses, using original addresses.", groupingError);
                // If grouping fails, we proceed with the original, ungrouped addresses.
            }
        }
        // --- END: AI-POWERED ADDRESS GROUPING ---

        const initialState: LandlordState = {
            income: finalIncome,
            expenses: finalExpenses,
            flagged: (jsonResponse.flaggedEntries || []).filter(Boolean),
        };
        setLandlordHistory([initialState]);
        setLandlordHistoryIndex(0);

    }, [prepareAndProcess, ai]);

     const handleProcessFinalAccountsReview = useCallback(async () => {
        const files: File[] = [currentYearPL, currentYearBS, currentYearTB, priorYearPL, priorYearBS, priorYearTB].filter((f): f is File => f !== null);

        setReviewPoints([]);
        setWorkingPapersHistory([[]]);
        setWorkingPapersHistoryIndex(0);

        const prompt = `You are an expert UK chartered accountant performing a final accounts review based on UK GAAP (FRS 102/105).
        **Client Context:**
        - Business Name: ${businessName || 'Not Provided'}
        - Client Code: ${clientCode || 'Not Provided'}
        - Business Type: ${businessType}
        - VAT Registered: ${isVatRegisteredReview ? 'Yes' : 'No'}
        - Accounting Period: ${periodStart} to ${periodEnd}
        - Additional Context: ${relevantContext || 'None provided'}
        
        **Task:**
        Review the attached financial documents. Your goal is to identify potential errors, omissions, and areas for further investigation and categorize their severity.
        
        For each point you identify, provide:
        1.  **area**: The area of the accounts affected (e.g., 'Balance Sheet', 'P&L', 'Compliance').
        2.  **issue**: A short title for the issue (e.g., 'Negative Cash Balance').
        3.  **explanation**: A detailed explanation of why this is a potential issue.
        4.  **severity**: Classify the issue as either 'Serious' or 'Minor'.
            -   **'Serious'**: Issues that are likely material, indicate a compliance breach, have significant tax implications (like an overdrawn Director's Loan Account), or represent a fundamental accounting error (e.g., negative cash, missing depreciation on fixed assets).
            -   **'Minor'**: Issues that are less likely to be material, such as small analytical review variances that require explanation, or presentational points.
        5.  **suggestedJournal**: A suggested journal entry to correct the error, if applicable. If not applicable, return \`null\` for this field.

        **Review Checklist:**
        - **Compliance:** Check for items inconsistent with the business type (e.g., a Director's Loan Account for a Sole Trader should be 'Drawings' - this is a 'Serious' issue).
        - **Balance Sheet Sanity Checks:**
            - Is cash/bank negative? ('Serious')
            - Are there fixed assets but no depreciation charge? ('Serious')
            - Is a Director's Loan Account overdrawn for a Limited Company? ('Serious' due to s455 tax implications).
        - **P&L Analysis:** Look for glaring omissions (e.g., no partner profit allocation for a partnership).
        - **Prior Year Comparison (if available):** Identify and comment on line items with variances > 20%. Classify as 'Minor' unless the variance is exceptionally large and unexplained.
        - **Contextual Review:** Take into account the 'Additional Context' provided.
        
        Return your findings as a single JSON object with one key 'reviewPoints'.`;
        
        const jsonResponse = await prepareAndProcess(prompt, finalAccountsReviewSchema, files);
        if (jsonResponse) {
            setReviewPoints((jsonResponse.reviewPoints || []).filter(Boolean));
        }
    }, [prepareAndProcess, businessName, clientCode, businessType, isVatRegisteredReview, periodStart, periodEnd, relevantContext, currentYearPL, currentYearBS, currentYearTB, priorYearPL, priorYearBS, priorYearTB]);

    const handleProcessPerformanceAnalysis = useCallback(async () => {
        const files: File[] = [...paManagementAccounts, ...paPriorAccounts, ...paPriorAnalysis];

        const businessNameForPrompt = paBusinessName || "the Business";
        const periodDescriptionForPrompt = paAnalysisPeriodDescription ? `(${paAnalysisPeriodDescription})` : '';
        const today = new Date();
        const formattedDate = today.toLocaleDateString('en-GB'); // dd/mm/yyyy

        const prompt = `You are a world-class UK business analyst. Create a professional business performance analysis report.

        **Output Requirements (CRITICAL):**
        Your output MUST be a single JSON object with two keys: "reportHtml" and "chartDataJson".

        1.  **reportHtml**: A string containing the full report as clean, well-structured HTML.
            -   Use semantic tags: \`<h1>\`, \`<h2>\`, \`<h3>\`, \`<p>\`, \`<ul>\`, \`<li>\`, \`<strong>\`, \`<em>\`.
            -   For tables, use a standard \`<table>\` with \`<thead>\`, \`<tbody>\`, \`<tr>\`, \`<th>\`, and \`<td>\`.
            -   **Color Highlighting (in Tables ONLY):** To highlight positive/negative trends inside tables, wrap the text in \`<span class="highlight-positive">...\` or \`<span class="highlight-negative">...\`. Do not use this outside of tables.
            -   **Cover Page:** The report MUST start with a cover page section using this exact structure: \`<div class="report-cover"><h1>Business Performance Report ${periodDescriptionForPrompt}</h1><h2>Prepared for: ${businessNameForPrompt}</h2><p>Date of Issue: ${formattedDate}</p></div>\`.

        2.  **chartDataJson**: A JSON **string** containing data for the KPI Benchmarking bar chart.
            -   The format must be an array of objects: \`[{"label": "KPI Name", "company": 25, "benchmark": 22}, ...]\`.
            -   Include 3-4 of the most important KPIs for the business type.
            -   **DO NOT** include this data or any placeholders for it in the 'reportHtml'.

        **Client & Business Context:**
        - Business Name: ${paBusinessName}
        - Business Type: ${paBusinessType}
        - Business Trade: ${paBusinessTrade}
        - Trading Location: ${paTradingLocation || 'Not specified'}
        - Analysis Period: ${paAnalysisPeriod}
        - Other Relevant Info / Key Priorities: ${paRelevantInfo}

        **Report Structure & Content (for the 'reportHtml' field):**

        ---
        
        [START WITH THE COVER PAGE HTML as specified above]

        ---

        <h1>Report Contents</h1>
        <ul>
            <li>Executive Summary</li>
            <li>Financial Performance Analysis</li>
            <li>Key Performance Indicators (KPIs) & Benchmarking</li>
            <li>SWOT Analysis</li>
            <li>Future Outlook & Projections</li>
            <li>Actionable Recommendations</li>
        </ul>
        
        ---
        
        <h1>Executive Summary</h1>
        <h2>Key Insights at a Glance</h2>
        <p>Provide a high-level overview of the key findings. Summarise the business's overall performance, highlighting the most critical financial trends and strategic takeaways.</p>

        ---

        <h1>Financial Performance Analysis</h1>
        <h2>Deep Dive into the Numbers</h2>
        <h3>Profit & Loss Analysis</h3>
        <p>Analyse revenue, cost of sales, gross profit margin, and net profit margin. Use a clear \`<table>\` for key figures. Highlight significant changes within the table using the specified \`<span>\` tags.</p>
        <h3>Balance Sheet Analysis</h3>
        <p>Comment on liquidity (current ratio), solvency, and key balances.</p>
        <h3>Comparative Analysis (IMPORTANT: Only if prior period data is available)</h3>
        <p>Perform a detailed comparison. Calculate key variances. Present this comparison in a multi-column \`<table>\`, using the highlight tags for variances.</p>
        
        ---

        <h1>KPI & Benchmarking</h1>
        <h2>How Do You Stack Up?</h2>
        <p>Calculate and explain key financial ratios (e.g., Gross Profit %, Net Profit %, Current Ratio, Debtor Days). Use your knowledge to benchmark these KPIs against typical industry averages for a '${paBusinessTrade}' in the '${paTradingLocation || 'the UK'}' area. Present this in a table comparing "Company KPI" vs. "Industry Benchmark".</p>
        
        ---

        <h1>SWOT Analysis</h1>
        <h2>Strengths, Weaknesses, Opportunities, Threats</h2>
        <p>Based on all the analysis, create four distinct sections with \`<h3>\` headings and \`<ul>\` lists for each.</p>
        
        ---

        <h1>Future Outlook & Projections</h1>
        <h2>The Path Ahead</h2>
        <p>Based on the analysis, provide a projected Profit & Loss forecast.</p>
        <p>Create a \`<table>\` with columns: "P&L Item", "Current Period", "1-Year Projection (Trend)", "5-Year Projection (Trend)", "10-Year Projection (Trend)", and "1-Year Projection (with Recommendations)". The "(Trend)" columns should extrapolate current performance, stating assumptions. The "(with Recommendations)" column should estimate the impact of your key recommendations. Use highlight tags for key projected figures.</p>
        <p>Add a short narrative explaining the key assumptions behind your projections.</p>
        
        ---

        <h1>Actionable Recommendations</h1>
        <h2>Next Steps</h2>
        <p>For EACH identified weakness and threat, provide a corresponding, specific, and actionable recommendation. Use \`<h3>\` and \`<p>\` tags for each recommendation.</p>
        <p><strong>(If prior analysis is available):</strong> Comment on whether recommendations from the prior period were actioned.</p>
        `;

        const jsonResponse = await prepareAndProcess(prompt, performanceAnalysisSchema, files);
        if (jsonResponse) {
            let chartData = [];
            try {
                // Ensure chartDataJson is a valid string before parsing
                if (typeof jsonResponse.chartDataJson === 'string' && jsonResponse.chartDataJson.trim()) {
                    chartData = JSON.parse(jsonResponse.chartDataJson);
                }
            } catch (e) {
                console.error("Failed to parse chart data from AI response:", e);
                // Keep chartData as an empty array on failure
            }
            setPerformanceReport({
                html: jsonResponse.reportHtml || '<p>Error: Report could not be generated.</p>',
                chartData: Array.isArray(chartData) ? chartData : [] // Ensure it's always an array
            });
        }
    }, [prepareAndProcess, paBusinessName, paManagementAccounts, paPriorAccounts, paPriorAnalysis, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription]);

    const handleProcessP32Summary = useCallback(async () => {
        const prompt = `You are an expert UK payroll administrator. Your task is to analyze the provided P32 Employer's Payment Record and draft a clear, concise, and friendly email to the client.

        The email must contain the following key information, extracted directly from the document:
        1.  The total amount payable to HMRC. Find this in the "[22] Total amount due" line and also mentioned as "Total amount payable to HMRC is...".
        2.  The payment deadline. Find this in the line "Payment should reach HMRC by...".
        3.  The Accounts Office Reference number. This is critical for the client to make the payment correctly.

        **Email Structure and Tone:**
        - You MUST find the client's name from the top left corner of the P32 document.
        - Start with a friendly greeting using the extracted client name (e.g., "Hi [Extracted Client Name],"). DO NOT use the placeholder "[Client Name]".
        - State the purpose of the email: to confirm the PAYE/NI liability for the specified tax month.
        - Clearly present the three key pieces of information (Amount, Due Date, Reference) in a simple, easy-to-read format. Maybe use bullet points or bolded labels.
        - Include the standard HMRC payment details (Account Name: HMRC Cumbernauld, Account No: 12001039, Sort Code: 08-32-10).
        - After mentioning the payment details and the Accounts Office Reference number, you MUST include the following line exactly as written: "More payment methods can be found using this link: www.gov.uk/pay-paye-tax"
        - End with a friendly closing (e.g., "Best regards,").

        **CRITICAL:** The entire output must be a single JSON object with one key: "emailBody". The value should be the complete text of the email, ready to be copied and pasted. You MUST NOT use markdown formatting like '**' for bolding. Use capital letters for emphasis. Use '\\n\\n' for paragraph breaks. Do not include any other text or explanation outside the JSON object.
        `;
        const jsonResponse = await prepareAndProcess(prompt, p32SummarySchema);
        if (jsonResponse) {
            setP32Email(jsonResponse.emailBody || "Could not generate email. Please check the document.");
        }
    }, [prepareAndProcess]);

     const handleProcessRiskAssessment = useCallback(async () => {
        const allQuestions = RISK_ASSESSMENT_QUESTIONS.flatMap(cat => cat.questions);
        // FIX: Explicitly type the destructured `value` to resolve TypeScript's `unknown` type inference for Object.entries.
        const answersText = Object.entries(raAnswers).map(([key, value]) => {
            const questionText = allQuestions.find(q => q.id === key)?.text || key;
            const typedValue = value as { answer: boolean; comment: string; };
            return `- Question ID: ${key}\n  Question: "${questionText}"\n  Answer: ${typedValue.answer ? 'Yes' : 'No'}\n  Comment: "${typedValue.comment || 'None'}"`;
        }).join('\n');

        const prompt = `
            You are a compliance officer for a UK accountancy firm, specializing in AML risk assessment based on ACCA guidelines. Your task is to analyze a completed client risk assessment questionnaire and produce a formal report. A 'Yes' answer generally indicates a higher risk factor. Pay special attention to questions about PEPs, sanctioned jurisdictions, cash-intensive businesses, and complex structures.

            **Assessment Details:**
            - Assessor's Name: ${raUsersName || 'Not Provided'}
            - Client Name: ${raClientName || 'Not Provided'}
            - Client Code: ${raClientCode || 'Not Provided'}
            - Client Type: ${raClientType || 'Not Provided'}

            **Questionnaire Answers:**
            ${answersText}

            **Your Task:**
            Based on these answers, provide a report in JSON format. The report must contain:
            1.  \`overallRiskLevel\`: Your assessment of the client's risk ('Low', 'Medium', or 'High').
            2.  \`riskJustification\`: A detailed paragraph explaining your reasoning for the assigned risk level. You MUST reference specific answers that influenced your decision.
            3.  \`summaryOfAnswers\`: An array of objects, one for each question, containing the 'questionId', 'question' text, the 'answer' ('Yes' or 'No'), and any 'userComment'. This must include ALL questions, not just the high-risk ones.
            4.  \`suggestedControls\`: A plain text section detailing specific, actionable controls to mitigate the identified risks (e.g., "Implement enhanced due diligence...", "Require senior management approval..."). Use double line breaks for paragraphs.
            5.  \`trainingSuggestions\`: A plain text section suggesting relevant training topics for the firm's staff based on the risks found (e.g., "Training on identifying complex corporate structures...", "Refresher on PEP identification..."). Use double line breaks for paragraphs.
        `;

        const jsonResponse = await prepareAndProcess(prompt, riskAssessmentSchema, []);
        if (jsonResponse) {
            setRiskAssessmentReport(jsonResponse);
        }
    }, [raUsersName, raClientName, raClientCode, raClientType, raAnswers, prepareAndProcess]);

    const handleProcess = useCallback(() => {
        if (!canProcess) return;
        setAppState('loading');
        setError(null);
        setProgress(0);

        // Reset results state for the current mode
        if (appMode === 'full_analysis') {
            setTransactionHistory([]);
            setHistoryIndex(-1);
            setFlaggedEntries([]);
            setLedgerAccounts([]);
            setSelectedIndices(new Set());
            handleProcessFullAnalysis();
        } else if (appMode === 'bank_to_csv') {
            setBankCsvResults([]);
            setLedgerAccounts([]);
            handleProcessBankAnalyser();
        } else if (appMode === 'summarise') {
            setSummarisedDocuments([]);
            handleProcessSummarise();
        } else if (appMode === 'landlord_analysis') {
            setLandlordHistory([]);
            setLandlordHistoryIndex(-1);
            handleProcessLandlordAnalysis();
        } else if (appMode === 'final_accounts_review') {
            setReviewPoints([]);
            setWorkingPapersHistory([[]]);
            setWorkingPapersHistoryIndex(0);
            handleProcessFinalAccountsReview();
        } else if (appMode === 'performance_analysis') {
            setPerformanceReport({ html: '', chartData: [] });
            handleProcessPerformanceAnalysis();
        } else if (appMode === 'p32_summary') {
            setP32Email('');
            handleProcessP32Summary();
        } else if (appMode === 'risk_assessment') {
            setRiskAssessmentReport(null);
            handleProcessRiskAssessment();
        }
    }, [canProcess, appMode, handleProcessFullAnalysis, handleProcessBankAnalyser, handleProcessSummarise, handleProcessLandlordAnalysis, handleProcessFinalAccountsReview, handleProcessPerformanceAnalysis, handleProcessP32Summary, handleProcessRiskAssessment]);

     const handleGenerateWorkingPapers = useCallback(async () => {
        if (reviewPoints.length === 0) return;
        setIsGeneratingPapers(true);
        setError(null);
        
        const today = new Date();
        const formattedDate = today.toLocaleDateString('en-GB');

        let prompt = `You are an expert UK chartered accountant preparing a standard UK working paper file.
        
        **Formatting Rules (CRITICAL):**
        - **DO NOT USE MARKDOWN.** No '#', '**', '*', or '\`\`\`'. Use plain text only.
        - Use ample whitespace: double line breaks between paragraphs and sections.
        - For tables, use monospaced text and align columns neatly with spaces.

        **Client Details & Context:**
        - Business Name: ${businessName || 'Not Provided'}
        - Client Code: ${clientCode || 'Not Provided'}
        - Business Type: ${businessType}
        - Accounting Period: ${periodStart} to ${periodEnd}
        - Prepared By: ${preparerName || 'Not Specified'}
        - Date of Generation: ${formattedDate}

        **Review Findings (Input):**
        ${JSON.stringify(reviewPoints)}
        
        **Task:**
        Create a set of working papers based on the structure below. Your response MUST be a JSON object containing a 'workingPapers' array.

        **Required Structure & Instructions:**

        ---
        **A1 - Notes for the principal:**
           - Based on the provided 'Review Findings' and the client context, write a comprehensive narrative summary and analysis of the accounts. 
           - Discuss each review point, its severity, and potential implications. 
           - Comment on the overall financial health and performance of the business for the period. 
           - This section should be detailed and well-written, suitable for a partner's final review.

        ---
        **ALL OTHER SECTIONS (A2 through H1):**
           - For every other section listed below, you MUST generate a BLANK template only. 
           - **DO NOT** populate any financial data. The user will complete these schedules manually.
           - Each template should include the correctly formatted table headers and a separator line, but NO data rows.

        **Detailed Section Templates:**

        **A2 - Journals:**
           - Provide the table template with headers: 'Debit Account', 'Credit Account', 'Amount', 'Description'.

        **B1 - Lead Asset Schedule:**
           - Provide the table template with headers: 'Account', 'B/Fwd', 'Additions', 'Disposals', 'C/Fwd'.

        **B2 - Depreciation Calculation:**
           - Provide the table template with headers: 'Asset', 'Cost', 'Rate %', 'Depreciation Charge'.

        **C1 - Debtors & Prepayments Reconciliation:**
           - Provide the table template with headers: 'Customer Name', 'Invoice No', 'Date', 'Amount', 'Notes'.

        **D1 - Bank Account Reconciliations:**
           - Provide a template for reconciliation: "Balance per bank statement:", "Add: Outstanding Lodgements:", "Less: Unpresented Cheques:", "Balance per trial balance:".

        **D2 - Cash Account:**
           - Provide space for a cash count confirmation.

        **E1 - Suppliers Control Reconciliation:**
           - Provide the table template with headers: 'Supplier Name', 'Invoice No', 'Date', 'Amount', 'Notes'.
           
        **F1 - Creditors & Accruals Reconciliation:**
           - Provide the table template with headers: 'Creditor Name', 'Description', 'Amount', 'Reasonable?'.
        
        ${businessType === 'limited_company' ? `
        **G1 - Directors Emoluments:**
           - Provide the table template with headers: 'Director Name', 'Gross Salary', 'PAYE/NI', 'Pension', 'Net Pay'.
        ` : ''}
        **G2 - Insurance:** Provide a placeholder for the user to verify cover.
        **G3 - Repairs and Renewals:** Provide a placeholder for the user to check for capital items.
        **G4 - Legal and Professional:** Provide a placeholder for the user to provide a breakdown.
        **G5 - Rent, Rates, Service Charge:** Provide a placeholder for the user notes.
        **G6 - Sundry:** Provide a placeholder for the user to provide a breakdown.
        
        ---
        **H1 - Other Notes:**
           - Provide a completely blank space for the user to enter any other notes or reconciliations. The content for this working paper MUST be an empty string.
            
        Return the output as a JSON object matching the required schema. The 'content' for each paper must adhere strictly to the plain text formatting rules.`;

        const jsonResponse = await prepareAndProcess(prompt, workingPapersSchema, []);
        if (jsonResponse) {
            const newPapers = (jsonResponse.workingPapers || []).filter(Boolean);
            const newHistory = workingPapersHistory.slice(0, workingPapersHistoryIndex + 1);
            setWorkingPapersHistory([...newHistory, newPapers]);
            setWorkingPapersHistoryIndex(newHistory.length);
        }
        setIsGeneratingPapers(false);
    }, [reviewPoints, prepareAndProcess, businessName, clientCode, businessType, periodStart, periodEnd, preparerName, currentYearTB, workingPapersHistory, workingPapersHistoryIndex]);

    const handleUpdateWorkingPaper = useCallback((index: number, content: string) => {
        const currentPapers = workingPapersHistory[workingPapersHistoryIndex];
        const updatedPapers = [...currentPapers];
        updatedPapers[index] = { ...updatedPapers[index], content };

        const newHistory = workingPapersHistory.slice(0, workingPapersHistoryIndex + 1);
        setWorkingPapersHistory([...newHistory, updatedPapers]);
        setWorkingPapersHistoryIndex(newHistory.length);
    }, [workingPapersHistory, workingPapersHistoryIndex]);

    const handleUndoWorkingPapers = useCallback(() => {
        if (canUndoWorkingPapers) {
            setWorkingPapersHistoryIndex(workingPapersHistoryIndex - 1);
        }
    }, [canUndoWorkingPapers, workingPapersHistoryIndex]);

    const handleRedoWorkingPapers = useCallback(() => {
        if (canRedoWorkingPapers) {
            setWorkingPapersHistoryIndex(workingPapersHistoryIndex + 1);
        }
    }, [canRedoWorkingPapers, workingPapersHistoryIndex]);

    const handleUpdateBankTransaction = useCallback((index: number, newAccountName: string) => {
        setBankCsvResults(currentResults => {
            const newResults = [...currentResults];
            const transactionToUpdate = { ...newResults[index] };
            
            const existingAccount = ledgerAccounts.find(acc => acc.name === newAccountName);

            transactionToUpdate.suggestedLedgerAccount = newAccountName;
            // Reset validation status as it's a manual override
            transactionToUpdate.ledgerValidation = {
                status: existingAccount ? 'perfect' : 'no-match',
                originalAiSuggestion: transactionToUpdate.ledgerValidation?.originalAiSuggestion || { name: 'N/A' }
            };
            
            newResults[index] = transactionToUpdate;
            return newResults;
        });
    }, [ledgerAccounts]);


    const handleDeleteFlaggedEntry = useCallback((indexToDelete: number) => {
        setFlaggedEntries(current => current.filter((_, index) => index !== indexToDelete));
    }, []);

    const handlePromoteFlaggedEntry = useCallback((indexToPromote: number, transaction: Transaction) => {
        const entryToPromote = flaggedEntries[indexToPromote];
        if (!entryToPromote) return;

        setFlaggedEntries(current => current.filter((_, index) => index !== indexToPromote));

        const newHistory = transactionHistory.slice(0, historyIndex + 1);
        const currentTransactions = newHistory[historyIndex] || [];
        const newTransactions = [...currentTransactions, transaction];
        
        setTransactionHistory([...newHistory, newTransactions]);
        setHistoryIndex(newHistory.length);
    }, [flaggedEntries, transactionHistory, historyIndex]);

    const handleRevise = useCallback(() => {
        setAppState('idle');
    }, []);

    const handleBackToSelection = useCallback(() => {
        setAppMode('selection');
    }, []);

    const handleUndo = useCallback(() => {
        if (canUndo) setHistoryIndex(historyIndex - 1);
    }, [canUndo, historyIndex]);

    const handleRedo = useCallback(() => {
        if (canRedo) setHistoryIndex(historyIndex + 1);
    }, [canRedo, historyIndex]);

    const updateTransactionInHistory = useCallback((index: number, updatedTx: Transaction) => {
        const newHistory = transactionHistory.slice(0, historyIndex + 1);
        const currentTransactions = newHistory[historyIndex] || [];
        const newTransactions = [...currentTransactions];
        newTransactions[index] = updatedTx;
        setTransactionHistory([...newHistory, newTransactions]);
        setHistoryIndex(newHistory.length);
    }, [transactionHistory, historyIndex]);

    const handleTransactionUpdate = useCallback((index: number, field: string, value: string | number) => {
        const txToUpdate = { ...processedTransactions[index] };
        (txToUpdate as any)[field] = value;
        updateTransactionInHistory(index, txToUpdate);
    }, [processedTransactions, updateTransactionInHistory]);

    const handleLedgerAccountChange = useCallback((index: number, newAccount: LedgerAccount) => {
        const txToUpdate = { ...processedTransactions[index] };
        if (targetSoftware === 'vt') (txToUpdate as VTTransaction).analysisAccount = newAccount.name;
        if (targetSoftware === 'capium') { (txToUpdate as CapiumTransaction).accountname = newAccount.name; (txToUpdate as CapiumTransaction).accountcode = newAccount.code || ''; }
        if (targetSoftware === 'xero') { (txToUpdate as XeroTransaction).accountName = newAccount.name; (txToUpdate as XeroTransaction).accountCode = newAccount.code || ''; }
        txToUpdate.ledgerValidation = { status: 'perfect', originalAiSuggestion: txToUpdate.ledgerValidation?.originalAiSuggestion || { name: 'N/A' } };
        updateTransactionInHistory(index, txToUpdate);
    }, [processedTransactions, targetSoftware, updateTransactionInHistory]);

    const handleSelectionChange = useCallback((action: SelectionChangeAction) => {
        setSelectedIndices(current => {
            const newSelection = new Set(current);
            if (action.type === 'add') newSelection.add(action.index);
            else if (action.type === 'remove') newSelection.delete(action.index);
            else if (action.type === 'all') action.indices.forEach(i => newSelection.add(i));
            else if (action.type === 'clear') newSelection.clear();
            return newSelection;
        });
    }, []);

    const handleBatchUpdate = useCallback((field: BatchUpdateField, value: LedgerAccount | string) => {
        const newHistory = transactionHistory.slice(0, historyIndex + 1);
        const newTransactions = (newHistory[historyIndex] || []).map((tx, index) => {
            if (selectedIndices.has(index)) {
                const updatedTx = { ...tx };
                if (field === 'primary') {
                    if (targetSoftware === 'vt') (updatedTx as VTTransaction).primaryAccount = value as string;
                    if (targetSoftware === 'capium') (updatedTx as CapiumTransaction).contactname = value as string;
                    if (targetSoftware === 'xero') (updatedTx as XeroTransaction).contactName = value as string;
                } else if (field === 'analysis') {
                    const account = value as LedgerAccount;
                    if (targetSoftware === 'vt') (updatedTx as VTTransaction).analysisAccount = account.name;
                    if (targetSoftware === 'capium') { (updatedTx as CapiumTransaction).accountname = account.name; (updatedTx as CapiumTransaction).accountcode = account.code || ''; }
                    if (targetSoftware === 'xero') { (updatedTx as XeroTransaction).accountName = account.name; (updatedTx as XeroTransaction).accountCode = account.code || ''; }
                    updatedTx.ledgerValidation = { status: 'perfect', originalAiSuggestion: updatedTx.ledgerValidation?.originalAiSuggestion || { name: 'N/A' } };
                }
                return updatedTx;
            }
            return tx;
        });
        setTransactionHistory([...newHistory, newTransactions]);
        setHistoryIndex(newHistory.length);
        setSelectedIndices(new Set());
    }, [transactionHistory, historyIndex, selectedIndices, targetSoftware]);

    const handleFlagTransactions = useCallback((indicesToFlag: Set<number>) => {
        const transactionsToKeep: Transaction[] = [];
        const entriesToFlag: FlaggedEntry[] = [];
        processedTransactions.forEach((tx, index) => {
            if (indicesToFlag.has(index)) {
                entriesToFlag.push({ fileName: tx.fileName, reason: "Manually flagged by user.", pageNumber: tx.pageNumber, transactionData: tx });
            } else {
                transactionsToKeep.push(tx);
            }
        });
        const newHistory = transactionHistory.slice(0, historyIndex + 1);
        setTransactionHistory([...newHistory, transactionsToKeep]);
        setHistoryIndex(newHistory.length);
        setFlaggedEntries(current => [...current, ...entriesToFlag]);
        setSelectedIndices(new Set());
    }, [processedTransactions, transactionHistory, historyIndex]);

    const handleLandlordExport = useCallback((type: 'income' | 'expenses' | 'landlord_summary_total' | 'landlord_summary_by_property', data: any[], options?: { header?: string }) => {
        setExportStatus({ active: true, message: 'Exporting...', progress: 50 });
        try {
            const dateStr = new Date().toISOString().slice(0, 10);
            let filename: string;
            // This type needs to match the one in `exportToCsv`
            let exportType: 'landlord_income' | 'landlord_expenses' | 'landlord_summary_total' | 'landlord_summary_by_property';

            switch (type) {
                case 'income':
                    filename = `export_landlord_income_${dateStr}.csv`;
                    exportType = 'landlord_income';
                    break;
                case 'expenses':
                    filename = `export_landlord_expenses_${dateStr}.csv`;
                    exportType = 'landlord_expenses';
                    break;
                case 'landlord_summary_total':
                    filename = `export_landlord_summary_total_${dateStr}.csv`;
                    exportType = 'landlord_summary_total';
                    break;
                case 'landlord_summary_by_property':
                    filename = `export_landlord_summary_property_${dateStr}.csv`;
                    exportType = 'landlord_summary_by_property';
                    break;
                default:
                    // This path should be unreachable with TypeScript, but it's good practice for safety
                    console.error("Invalid export type for landlord analysis:", type);
                    throw new Error("Invalid export type for landlord analysis.");
            }

            exportToCsv(data, filename, exportType, options);

            setExportStatus({ active: true, message: 'Export Complete!', progress: 100 });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to export CSV.");
            setExportStatus({ active: false, message: 'Export Failed', progress: 0 });
        } finally {
            setTimeout(() => setExportStatus({ active: false, message: '', progress: 0 }), 2000);
        }
    }, []);
    
    const handleUpdatePerformanceReport = useCallback((newReport: PerformanceReport) => {
        setPerformanceReport(newReport);
    }, []);
    
    const updateLandlordState = useCallback((newState: Partial<LandlordState>) => {
        const current = landlordHistory[landlordHistoryIndex] || { income: [], expenses: [], flagged: [] };
        const nextState = { ...current, ...newState };
        const newHistory = landlordHistory.slice(0, landlordHistoryIndex + 1);
        setLandlordHistory([...newHistory, nextState]);
        setLandlordHistoryIndex(newHistory.length);
    }, [landlordHistory, landlordHistoryIndex]);
    
    const handleUpdateLandlordIncomeTransaction = useCallback((index: number, field: keyof LandlordIncomeTransaction, value: string | number) => {
        const newIncome = [...landlordIncome];
        newIncome[index] = { ...newIncome[index], [field]: value };
        updateLandlordState({ income: newIncome });
    }, [landlordIncome, updateLandlordState]);

    const handleUpdateLandlordTransaction = useCallback((index: number, field: keyof LandlordExpenseTransaction, value: string | number | boolean) => {
        const newExpenses = [...landlordTransactions];
        newExpenses[index] = { ...newExpenses[index], [field]: value };
        updateLandlordState({ expenses: newExpenses });
    }, [landlordTransactions, updateLandlordState]);

    const handleBatchUpdateLandlord = useCallback((indices: Set<number>, field: keyof LandlordExpenseTransaction, value: string | boolean) => {
        const newExpenses = landlordTransactions.map((tx, i) => indices.has(i) ? { ...tx, [field]: value } : tx);
        updateLandlordState({ expenses: newExpenses });
    }, [landlordTransactions, updateLandlordState]);

    const handleBatchUpdateLandlordIncome = useCallback((indices: Set<number>, field: keyof LandlordIncomeTransaction, value: string) => {
        const newIncome = landlordIncome.map((tx, i) => indices.has(i) ? { ...tx, [field]: value } : tx);
        updateLandlordState({ income: newIncome });
    }, [landlordIncome, updateLandlordState]);
    
    const handleBatchFlagLandlordTransactions = useCallback((indices: Set<number>) => {
        const expensesToKeep: LandlordExpenseTransaction[] = [];
        const newFlagged: FlaggedEntry[] = [];
        landlordTransactions.forEach((tx, i) => {
            if (indices.has(i)) {
                newFlagged.push({ fileName: tx.fileName, reason: 'Manually flagged', date: tx.DueDate, supplier: tx.Supplier, amount: tx.Amount, description: tx.Description });
            } else {
                expensesToKeep.push(tx);
            }
        });
        updateLandlordState({
            expenses: expensesToKeep,
            flagged: [...flaggedLandlordEntries, ...newFlagged],
        });
    }, [landlordTransactions, flaggedLandlordEntries, updateLandlordState]);

    const handleBatchFlagLandlordIncomeTransactions = useCallback((indices: Set<number>) => {
        const incomeToKeep: LandlordIncomeTransaction[] = [];
        const newFlagged: FlaggedEntry[] = [];
        landlordIncome.forEach((tx, i) => {
            if (indices.has(i)) {
                newFlagged.push({ 
                    fileName: tx.fileName, 
                    reason: 'Manually flagged', 
                    date: tx.Date, 
                    supplier: tx.PropertyAddress, // Use PropertyAddress as the 'supplier' for context
                    amount: tx.Amount, 
                    description: tx.Description 
                });
            } else {
                incomeToKeep.push(tx);
            }
        });
        updateLandlordState({
            income: incomeToKeep,
            flagged: [...flaggedLandlordEntries, ...newFlagged],
        });
    }, [landlordIncome, flaggedLandlordEntries, updateLandlordState]);


    const handleManualValidateLandlord = useCallback((entriesToValidate: FlaggedEntry[], category: string, propertyAddress: string) => {
        const validationSet = new Set(entriesToValidate);
        const newFlagged = flaggedLandlordEntries.filter(entry => !validationSet.has(entry));
        
        let newIncome = [...landlordIncome];
        let newExpenses = [...landlordTransactions];
        const finalPropertyAddress = propertyAddress.trim() || "No Address";

        if (category === LANDLORD_INCOME_CATEGORY) {
            const newTxs: LandlordIncomeTransaction[] = entriesToValidate.map(e => ({
                fileName: e.fileName,
                Date: e.date || new Date().toISOString().split('T')[0],
                PropertyAddress: finalPropertyAddress,
                Description: e.description || e.reason || 'Manually validated',
                Category: LANDLORD_INCOME_CATEGORY,
                Amount: e.amount || 0,
            }));
            newIncome.push(...newTxs);

        } else {
            const newTxs: LandlordExpenseTransaction[] = entriesToValidate.map(e => ({
                fileName: e.fileName,
                DueDate: e.date || new Date().toISOString().split('T')[0],
                Description: e.description || e.reason || 'Manually validated',
                Category: category,
                Amount: e.amount || 0,
                Supplier: e.supplier || '',
                TenantPayable: false,
                CapitalExpense: false,
                PropertyAddress: finalPropertyAddress,
            }));
            newExpenses.push(...newTxs);
        }
        
        updateLandlordState({
            flagged: newFlagged,
            income: newIncome,
            expenses: newExpenses,
        });
    }, [landlordIncome, landlordTransactions, flaggedLandlordEntries, updateLandlordState]);

    const handleDeleteLandlordFlaggedEntry = useCallback((indexToDelete: number) => {
        const newFlagged = flaggedLandlordEntries.filter((_, index) => index !== indexToDelete);
        updateLandlordState({ flagged: newFlagged });
    }, [flaggedLandlordEntries, updateLandlordState]);

    const handleUndoLandlord = useCallback(() => {
        if (canUndoLandlord) {
            setLandlordHistoryIndex(landlordHistoryIndex - 1);
        }
    }, [canUndoLandlord, landlordHistoryIndex]);

    const handleRedoLandlord = useCallback(() => {
        if (canRedoLandlord) {
            setLandlordHistoryIndex(landlordHistoryIndex + 1);
        }
    }, [canRedoLandlord, landlordHistoryIndex]);

    const handleAskSmithAboutError = useCallback((error: Error, errorInfo?: React.ErrorInfo) => {
        const event = new CustomEvent('askSmithError', {
            detail: { error, errorInfo }
        });
        window.dispatchEvent(event);
    }, []);

    const handleExportWithUploads = useCallback(async (options: { uploadAttachments: boolean }) => {
        const FOLDER_NAME = "Agent Smith Attachments";

        const findOrCreateFolder = async (): Promise<string | null> => {
            try {
// FIX: Changed gapi to window.gapi to access the global object.
                const response = await window.gapi.client.drive.files.list({
                    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`,
                    fields: 'files(id, name)',
                });
                if (response.result.files.length > 0) {
                    return response.result.files[0].id;
                } else {
                    const fileMetadata = {
                        name: FOLDER_NAME,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: ['root'],
                    };
// FIX: Changed gapi to window.gapi to access the global object.
                    const createResponse = await window.gapi.client.drive.files.create({ resource: fileMetadata, fields: 'id' });
                    return createResponse.result.id;
                }
            } catch (err) {
                console.error("Error finding or creating Drive folder:", err);
                setError("Could not access or create the Google Drive folder. Please check your permissions.");
                return null;
            }
        };

        setExportStatus({ active: true, message: 'Preparing to export...', progress: 0 });

        if (options.uploadAttachments && isGoogleDriveConnected) {
            // Check if token exists before proceeding
            const token = window.gapi.client.getToken();
            if (!token || !token.access_token) {
                setError("Google Drive token is missing or has expired. Please disconnect and reconnect to Google Drive from the header.");
                setIsGoogleDriveConnected(false); // Update UI state to reflect disconnection
                setExportStatus({ active: false, message: '', progress: 0 });
                return;
            }

            const folderId = await findOrCreateFolder();
            if (!folderId) {
                setExportStatus({ active: false, message: '', progress: 0 });
                return;
            }

            const transactionsToUpdate = [...processedTransactions];
            const totalFiles = transactionsToUpdate.length;

            for (let i = 0; i < totalFiles; i++) {
                const tx = transactionsToUpdate[i];
                setExportStatus({ active: true, message: `Uploading ${tx.fileName}... (${i + 1} of ${totalFiles})`, progress: (i / totalFiles) * 100 });

                const sourceFile = documentFiles.find(f => f.name === tx.fileName);
                if (!sourceFile) {
                    console.warn(`Source file not found for ${tx.fileName}`);
                    continue;
                }
                
                try {
                    const fileToUpload = await compressImage(sourceFile);
                    
                    const metadata = { name: sourceFile.name, parents: [folderId] };
                    const form = new FormData();
                    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                    form.append('file', fileToUpload);
                    
                    const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                        method: 'POST',
                        headers: new Headers({ 'Authorization': 'Bearer ' + token.access_token }),
                        body: form,
                    });
                    
                    const uploadedFile = await uploadResponse.json();
                    
// FIX: Changed gapi to window.gapi to access the global object.
                    await window.gapi.client.drive.permissions.create({
                        fileId: uploadedFile.id,
                        resource: { role: 'reader', type: 'anyone' },
                    });

// FIX: Changed gapi to window.gapi to access the global object.
                    const fileDetails = await window.gapi.client.drive.files.get({
                        fileId: uploadedFile.id,
                        fields: 'webViewLink',
                    });
                    
                    transactionsToUpdate[i] = { ...tx, driveLink: fileDetails.result.webViewLink };

                } catch (err) {
                     console.error(`Failed to upload ${tx.fileName}:`, err);
                     transactionsToUpdate[i] = { ...tx, transactionNotes: `${tx.transactionNotes || ''} [UPLOAD FAILED]` };
                }
            }
             exportToCsv(transactionsToUpdate, `export_${targetSoftware}_${new Date().toISOString().slice(0, 10)}.csv`, targetSoftware);

        } else {
            // Standard export without uploads
            exportToCsv(processedTransactions, `export_${targetSoftware}_${new Date().toISOString().slice(0, 10)}.csv`, targetSoftware);
        }

        setExportStatus({ active: true, message: 'Export complete!', progress: 100 });
        setTimeout(() => setExportStatus({ active: false, message: '', progress: 0 }), 2000);

    }, [processedTransactions, targetSoftware, documentFiles, isGoogleDriveConnected]);

    if (!apiKey) return <ApiKeyInstructions onKeySubmit={handleKeySubmit} />;
    if (isChangingApiKey) return <ApiKeyInstructions onKeySubmit={handleKeySubmit} onCancel={() => setIsChangingApiKey(false)} />;

    const renderFileUploadScreen = () => (
        <div className="max-w-7xl mx-auto">
            {appMode === 'full_analysis' && (
                <>
                    <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg">
                        <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Full Transaction Analysis</h3>
                        <p className="text-center text-xs text-slate-500 mt-2">
                            The complete bookkeeping tool. Upload invoices, receipts, and bank statements. The AI will extract transactions, suggest ledger allocations, flag potential duplicates, and prepare a file for your accounting software.
                        </p>
                    </div>
                    <ClientDetails clientName={clientName} setClientName={setClientName} clientAddress={clientAddress} setClientAddress={setClientAddress} isVatRegistered={isVatRegistered} setIsVatRegistered={setIsVatRegistered} />
                    <SoftwareSelector selected={targetSoftware} onChange={setTargetSoftware} />
                </>
            )}
            {appMode === 'bank_to_csv' && (
                <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Bank Statement Analyser</h3>
                    <p className="text-center text-xs text-slate-500 mt-2">
                        Convert PDF or image-based bank statements into a structured CSV file. The AI will automatically extract each transaction and suggest a relevant ledger account based on the description.
                    </p>
                </div>
            )}
            {appMode === 'summarise' && (
                <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Summarise Documents</h3>
                    <p className="text-center text-xs text-slate-500 mt-2">
                        Upload your documents below. The AI will analyse the content for relevant service periods, not just the invoice date, and create a full summary. You will be able to filter by date on the results screen.
                    </p>
                </div>
            )}
             {appMode === 'landlord_analysis' && (
                 <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Landlord Analysis</h3>
                    <p className="text-center text-xs text-slate-500 mt-2">
                        Analyse letting agent statements, invoices, and receipts for property businesses. The AI will differentiate between rental income and allowable expenses, creating separate lists for review and export.
                    </p>
                </div>
            )}
            {appMode === 'final_accounts_review' && (
                 <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Final Accounts Review</h3>
                    <p className="text-center text-xs text-slate-500 mt-2 mb-4">
                        Review a full set of accounts against UK GAAP. Upload the P&L, Balance Sheet, and Trial Balance for both the current and prior year. The AI will identify potential issues and generate a full, editable working paper file.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business Name" className="w-full p-2 border rounded-md" />
                        <input type="text" value={clientCode} onChange={e => setClientCode(e.target.value)} placeholder="Client Code (Optional)" className="w-full p-2 border rounded-md" />
                        <select value={businessType} onChange={e => setBusinessType(e.target.value as any)} className="w-full p-2 border rounded-md">
                            <option value="">-- Select Business Type --</option>
                            <option value="sole_trader">Sole Trader</option>
                            <option value="partnership">Partnership</option>
                            <option value="limited_company">Limited Company</option>
                        </select>
                        <input type="text" onFocus={e => e.target.type='date'} onBlur={e => e.target.type='text'} value={periodStart} onChange={e => setPeriodStart(e.target.value)} placeholder="Period Start Date" className="w-full p-2 border rounded-md" />
                        <input type="text" onFocus={e => e.target.type='date'} onBlur={e => e.target.type='text'} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} placeholder="Period End Date" className="w-full p-2 border rounded-md" />
                         <div className="flex items-center justify-center">
                            <label className="text-sm font-medium text-slate-700 mr-3">VAT Registered?</label>
                            <button type="button" onClick={() => setIsVatRegisteredReview(!isVatRegisteredReview)} className={`${isVatRegisteredReview ? 'bg-primary' : 'bg-slate-300'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors`}>
                                <span className={`${isVatRegisteredReview ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition`} />
                            </button>
                        </div>
                    </div>
                     <textarea value={relevantContext} onChange={e => setRelevantContext(e.target.value)} placeholder="Any other relevant context or questions for the AI to consider? (Optional)" rows={2} className="w-full p-2 border rounded-md" />
                 </div>
            )}
            {appMode === 'performance_analysis' && (
                <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">Business Performance Analysis</h3>
                    <p className="text-center text-xs text-slate-500 mt-2 mb-4">
                        Generate a client-ready business performance report. Upload management accounts and, optionally, prior period data. The AI will perform a deep-dive analysis, calculating KPIs and benchmarking them against industry averages.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <input type="text" value={paBusinessName} onChange={e => setPaBusinessName(e.target.value)} placeholder="* Business Name" className="w-full p-2 border rounded-md" />
                        <select value={paBusinessType} onChange={e => setPaBusinessType(e.target.value as any)} className="w-full p-2 border rounded-md">
                            <option value="">* Select Business Type</option><option value="sole_trader">Sole Trader</option><option value="partnership">Partnership</option><option value="limited_company">Limited Company</option>
                        </select>
                        <input type="text" value={paBusinessTrade} onChange={e => setPaBusinessTrade(e.target.value)} placeholder="* Business Trade (e.g., Cafe, Plumber)" className="w-full p-2 border rounded-md" />
                        <input type="text" value={paTradingLocation} onChange={e => setPaTradingLocation(e.target.value)} placeholder="Trading Location (e.g., London)" className="w-full p-2 border rounded-md" />
                        <select value={paAnalysisPeriod} onChange={e => setPaAnalysisPeriod(e.target.value as any)} className="w-full p-2 border rounded-md">
                            <option value="">* Select Analysis Period</option><option value="yearly">Yearly</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
                        </select>
                        <input type="text" value={paAnalysisPeriodDescription} onChange={e => setPaAnalysisPeriodDescription(e.target.value)} placeholder="Period Description (e.g., Q2 2024)" className="w-full p-2 border rounded-md" />
                    </div>
                     <textarea value={paRelevantInfo} onChange={e => setPaRelevantInfo(e.target.value)} placeholder="Any other relevant info or key business priorities to consider?" rows={2} className="w-full p-2 border rounded-md" />
                </div>
            )}
            {appMode === 'p32_summary' && (
                <div className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-lg">
                    <h3 className="text-lg font-semibold text-slate-700 text-center mb-4">P32 Summary</h3>
                    <p className="text-center text-xs text-slate-500 mt-2">
                        Quickly generate a client-ready email from a P32 Employer's Payment Record. The AI will extract the key payment details (amount, due date, reference) and draft a professional email for you to copy.
                    </p>
                </div>
            )}
            {appMode === 'risk_assessment' && (
                <RiskAssessmentForm
                    userName={raUsersName} setUserName={setRaUsersName}
                    clientName={raClientName} setClientName={setRaClientName}
                    clientCode={raClientCode} setClientCode={setRaClientCode}
                    clientType={raClientType} setClientType={setRaClientType}
                    answers={raAnswers} setAnswers={setRaAnswers}
                />
            )}
            <div className={`grid ${appMode === 'p32_summary' || appMode === 'bank_to_csv' || appMode === 'landlord_analysis' || appMode === 'summarise' ? 'md:grid-cols-1' : (appMode === 'risk_assessment' ? 'hidden' : 'md:grid-cols-2')} gap-6 items-start`}>
                 {appMode === 'full_analysis' && (
                    <>
                        <FileUpload title="3. Documents to Analyse" onFilesChange={handleSetDocuments} multiple accept="application/pdf,image/*" helpText="Upload invoices, receipts, and bank statements." existingFiles={documentFiles} />
                        <div className="space-y-6">
                            <FileUpload title="4. Past Transactions (CSV)" onFileChange={setPastTransactionsFile} accept=".csv" optional helpText="Helps identify duplicate transactions." existingFiles={pastTransactionsFile ? [pastTransactionsFile] : []} />
                            <FileUpload title="5. Chart of Accounts (CSV)" onFileChange={setLedgersFile} accept=".csv" optional helpText="Improves accuracy of ledger allocation." existingFiles={ledgersFile ? [ledgersFile] : []} />
                        </div>
                    </>
                 )}
                  {appMode === 'bank_to_csv' && <FileUpload title="Upload Bank Statement(s)" onFilesChange={handleSetDocuments} multiple accept="application/pdf,image/*" helpText="Upload PDF statements to convert to CSV." existingFiles={documentFiles} /> }
                  {appMode === 'summarise' && <FileUpload title="Upload Documents to Summarise" onFilesChange={handleSetDocuments} multiple accept="application/pdf,image/*" helpText="Upload invoices, receipts, etc." existingFiles={documentFiles} />}
                  {appMode === 'landlord_analysis' && <FileUpload title="Upload Landlord Documents" onFilesChange={handleSetDocuments} multiple accept="application/pdf,image/*" helpText="Upload letting agent statements, invoices, and receipts." existingFiles={documentFiles} />}
                  {appMode === 'p32_summary' && <FileUpload title="Upload P32 Document" onFileChange={(file) => handleSetDocuments(file ? [file] : [])} accept="application/pdf,image/*" helpText="Upload a single P32 form to generate a client email." existingFiles={documentFiles} />}

                  {appMode === 'final_accounts_review' && (
                      <>
                        <div className="space-y-4">
                            <FileUpload title="Current Year P&L" onFileChange={setCurrentYearPL} accept="application/pdf" existingFiles={currentYearPL ? [currentYearPL] : []} />
                            <FileUpload title="Current Year Balance Sheet" onFileChange={setCurrentYearBS} accept="application/pdf" existingFiles={currentYearBS ? [currentYearBS] : []} />
                            <FileUpload title="Current Year Trial Balance" onFileChange={setCurrentYearTB} accept="application/pdf" existingFiles={currentYearTB ? [currentYearTB] : []} />
                        </div>
                         <div className="space-y-4">
                            <FileUpload title="Prior Year P&L" onFileChange={setPriorYearPL} accept="application/pdf" optional existingFiles={priorYearPL ? [priorYearPL] : []} />
                            <FileUpload title="Prior Year Balance Sheet" onFileChange={setPriorYearBS} accept="application/pdf" optional existingFiles={priorYearBS ? [priorYearBS] : []} />
                            <FileUpload title="Prior Year Trial Balance" onFileChange={setPriorYearTB} accept="application/pdf" optional existingFiles={priorYearTB ? [priorYearTB] : []} />
                        </div>
                      </>
                  )}

                   {appMode === 'performance_analysis' && (
                      <>
                        <FileUpload title="* Management Accounts" onFilesChange={setPaManagementAccounts} multiple accept="application/pdf" helpText="e.g., P&L, Balance Sheet for the current period." existingFiles={paManagementAccounts} />
                        <div className="space-y-6">
                           <FileUpload title="Prior Period Accounts" onFilesChange={setPaPriorAccounts} multiple accept="application/pdf" optional helpText="For comparative analysis." existingFiles={paPriorAccounts} />
                           <FileUpload title="Prior Analysis/Reports" onFilesChange={setPaPriorAnalysis} multiple accept="application/pdf" optional helpText="For context and follow-up." existingFiles={paPriorAnalysis} />
                        </div>
                      </>
                  )}
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={handleProcess}
                    disabled={!canProcess}
                    className="inline-flex items-center justify-center bg-primary text-white font-bold text-lg py-3 px-8 rounded-lg shadow-lg hover:bg-primary-700 transition-all duration-200 transform hover:scale-105 disabled:bg-slate-500 disabled:cursor-not-allowed disabled:scale-100"
                >
                    <CalculatorIcon />
                    <span>{appMode === 'risk_assessment' ? 'Analyse Assessment' : 'Analyse Documents'}</span>
                </button>
            </div>
        </div>
    );

    const renderResults = () => {
        switch (appMode) {
            case 'full_analysis':
                return <ResultsDisplay
                    transactions={processedTransactions}
                    flaggedEntries={flaggedEntries}
                    currentView={currentView}
                    setCurrentView={setCurrentView}
                    targetSoftware={targetSoftware}
                    documentPreviews={documentPreviews}
                    ledgerAccounts={ledgerAccounts}
                    onTransactionUpdate={handleTransactionUpdate}
                    onLedgerAccountChange={handleLedgerAccountChange}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    selectedIndices={selectedIndices}
                    onSelectionChange={handleSelectionChange}
                    onBatchUpdate={handleBatchUpdate}
                    onFlagTransactions={handleFlagTransactions}
                    onRevise={handleRevise}
                    onExport={handleExportWithUploads}
                    isExporting={exportStatus.active}
                    onDeleteFlaggedEntry={handleDeleteFlaggedEntry}
                    onPromoteFlaggedEntry={handlePromoteFlaggedEntry}
                    isGoogleDriveConnected={isGoogleDriveConnected}
                    onSignInGoogleDrive={handleGoogleSignIn}
                />;
            case 'bank_to_csv':
                return <BankToCsvResults
                    results={bankCsvResults}
                    ledgerAccounts={ledgerAccounts}
                    onRevise={handleRevise}
                    onExport={() => exportToCsv(bankCsvResults, `export_bank_statement_${new Date().toISOString().slice(0, 10)}.csv`, 'bank_to_csv')}
                    isExporting={exportStatus.active}
                    onUpdateTransaction={handleUpdateBankTransaction}
                />;
            case 'summarise':
                return <SummariseResults
                    documents={summarisedDocuments}
                    onRevise={handleRevise}
                    isExporting={exportStatus.active}
                />;
            case 'landlord_analysis':
                return <LandlordResults
                    incomeResults={landlordIncome}
                    expenseResults={landlordTransactions}
                    flaggedEntries={flaggedLandlordEntries}
                    documentPreviews={documentPreviews}
                    onRevise={handleRevise}
                    onExport={handleLandlordExport}
                    isExporting={exportStatus.active}
                    onUpdateIncomeTransaction={handleUpdateLandlordIncomeTransaction}
                    onUpdateExpenseTransaction={handleUpdateLandlordTransaction}
                    onBatchUpdateExpense={handleBatchUpdateLandlord}
                    onBatchUpdateIncome={handleBatchUpdateLandlordIncome}
                    onBatchFlagTransactions={handleBatchFlagLandlordTransactions}
                    onManualValidate={handleManualValidateLandlord}
                    onBatchFlagIncomeTransactions={handleBatchFlagLandlordIncomeTransactions}
                    onDeleteFlaggedEntry={handleDeleteLandlordFlaggedEntry}
                    onUndo={handleUndoLandlord}
                    onRedo={handleRedoLandlord}
                    canUndo={canUndoLandlord}
                    canRedo={canRedoLandlord}
                />;
            case 'final_accounts_review':
                return <FinalAccountsReviewResults
                    reviewPoints={reviewPoints}
                    workingPapers={workingPapers}
                    isGeneratingPapers={isGeneratingPapers}
                    onGenerateWorkingPapers={handleGenerateWorkingPapers}
                    onUpdateWorkingPaper={handleUpdateWorkingPaper}
                    onRevise={handleRevise}
                    preparerName={preparerName}
                    onSetPreparerName={setPreparerName}
                    businessName={businessName}
                    clientCode={clientCode}
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                    businessType={businessType}
                    isVatRegistered={isVatRegisteredReview}
                    relevantContext={relevantContext}
                    onUndoWorkingPaper={handleUndoWorkingPapers}
                    onRedoWorkingPaper={handleRedoWorkingPapers}
                    canUndoWorkingPaper={canUndoWorkingPapers}
                    canRedoWorkingPaper={canRedoWorkingPapers}
                />;
            case 'performance_analysis':
                return <PerformanceAnalysisResults
                    report={performanceReport}
                    onUpdateReport={handleUpdatePerformanceReport}
                    onRevise={handleRevise}
                />;
            case 'p32_summary':
                return <P32SummaryResults
                    emailBody={p32Email}
                    onRevise={handleRevise}
                    documentFile={documentFiles.length > 0 ? documentFiles[0] : null}
                    documentPreviews={documentPreviews}
                />;
            case 'risk_assessment':
                return <RiskAssessmentResults
                    report={riskAssessmentReport}
                    onRevise={handleRevise}
                    clientDetails={{
                        userName: raUsersName,
                        clientName: raClientName,
                        clientCode: raClientCode,
                        clientType: raClientType,
                    }}
                />;
            default:
                return null;
        }
    };
    
    const renderMainContent = () => {
        if (authMessage && authMessage.type === 'error' && authMessage.text.includes('Configuration Error') && appState !== 'loading') {
            return (
                <GoogleAuthErrorScreen 
                    onRetry={handleGoogleSignIn} 
                    onBack={() => setAuthMessage(null)} 
                />
            );
        }

        return (
            <React.Fragment>
                {appMode === 'selection' && appState !== 'loading' && appState !== 'error' && (
                    <ModeSelectorScreen onModeSelect={(mode) => {
                        handleResetApp();
                        setAppMode(mode);
                    }} />
                )}

                {appMode !== 'selection' && appMode !== 'ask_smith' && appMode !== 'policies_and_procedures' && appState === 'idle' && renderFileUploadScreen()}
                
                {appState === 'success' && renderResults()}

                {appMode === 'policies_and_procedures' && appState !== 'loading' && appState !== 'error' && (
                    <PoliciesAndProcedures />
                )}
            </React.Fragment>
        );
    };

    return (
        <div className="flex flex-col min-h-screen bg-slate-100">
            {appMode !== 'selection' && (
                <Header 
                    onBackToSelection={handleBackToSelection}
                    onChangeApiKey={handleChangeApiKey}
                    onResetApp={handleResetApp}
                    isGoogleDriveConnected={isGoogleDriveConnected}
                    onSignInGoogleDrive={handleGoogleSignIn}
                    onSignOutGoogleDrive={handleGoogleSignOut}
                />
            )}
             {authMessage && (
                <div className={`relative px-4 py-3 text-center text-sm font-medium ${
                    authMessage.type === 'success' ? 'bg-green-100 text-green-800' :
                    authMessage.type === 'error' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800' // Info style
                }`} role="alert">
                    {authMessage.text}
                    {authMessage.type !== 'info' && (
                        <button onClick={() => setAuthMessage(null)} className={`absolute top-1/2 right-4 -translate-y-1/2 ${
                            authMessage.type === 'success' ? 'text-green-800' : 
                            authMessage.type === 'error' ? 'text-red-800' : ''
                        }`}>
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
            )}
            <main className={`flex-grow container mx-auto p-4 sm:p-6 lg:p-8 ${appMode === 'ask_smith' || appMode === 'policies_and_procedures' ? '!p-0' : ''}`}>
                {appState === 'loading' && <ProcessingView progress={progress} fileCount={documentFiles.length} />}
                
                {appState === 'error' && (
                    <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-lg border border-red-200 text-center">
                        <ErrorIcon />
                        <h2 className="text-2xl font-bold text-red-700 mt-4">Analysis Failed</h2>
                        <p className="text-slate-600 mt-2">An error occurred during processing. Please try again.</p>
                        <pre className="mt-4 text-left bg-red-50 text-red-800 p-4 rounded-md text-sm whitespace-pre-wrap break-all">{error}</pre>
                        <div className="mt-6 flex justify-center gap-4">
                            <button onClick={handleRevise} className="bg-primary text-white font-semibold py-2 px-5 rounded-lg">Try Again</button>
                            <button onClick={() => handleAskSmithAboutError(new Error(error || 'Unknown error'))} className="bg-slate-700 text-white font-semibold py-2 px-5 rounded-lg">Ask Smith To Explain</button>
                        </div>
                    </div>
                )}
                
                {renderMainContent()}

                {appMode === 'ask_smith' && appState !== 'loading' && appState !== 'error' && (
                    ai ? <AskSmith ai={ai} /> : <p className="text-center">Initializing AI, please wait...</p>
                )}

            </main>
            {appMode !== 'ask_smith' && appMode !== 'policies_and_procedures' && ai && <FloatingAskSmith ai={ai} />}

            {exportStatus.active && (
                <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md text-center">
                        {exportStatus.progress < 100 ? (
                            <>
                                <Spinner className="mx-auto text-primary h-8 w-8" />
                                <h3 className="text-xl font-bold text-slate-800 mt-4">Export in Progress</h3>
                            </>
                        ) : (
                            <>
                                <CheckCircleIcon className="mx-auto text-green-500 h-12 w-12" />
                                <h3 className="text-xl font-bold text-slate-800 mt-4">Export Complete</h3>
                            </>
                        )}
                        <p className="text-slate-600 mt-2 text-sm">{exportStatus.message}</p>
                        <div className="w-full bg-slate-200 rounded-full h-2.5 mt-4">
                            <div className="bg-primary h-2.5 rounded-full transition-all" style={{width: `${exportStatus.progress}%`}}></div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};