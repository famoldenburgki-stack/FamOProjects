#Requires -Version 5.1
<#
    DocKit — Baukasten für Schriftgut. Offline, portabel, ohne Installation.

    Läuft mit reinen Windows-Bordmitteln: PowerShell 5.1 und WinForms, beide Teil
    des Betriebssystems. Keine Fremdbibliothek, kein Paketmanager, keine Installation.


    WAS DAS PROGRAMM TUT
    --------------------
      • meldet eine systemweite Tastenkombination an (Strg+Alt+T, änderbar)
      • legt Text in die Zwischenablage und sendet Strg+V an das zuvor aktive Fenster
      • liest und schreibt eine selbst gewählte Textbausteindatei (JSON, Endung .tbd)
      • schreibt die Einstellungen des Anwenders nach %APPDATA%\DocKit
      • kopiert auf Wunsch Vorlagendateien und schreibt über Word einen Baustein hinein
      • fragt den Explorer nach dem gerade geöffneten Ordner (Shell.Application)

    WAS ES NICHT TUT
    ----------------
      • keine Netzverbindung, kein Download, keine Telemetrie
      • kein Schreiben in die Registry
      • kein Autostart, kein Dienst, keine geplante Aufgabe
      • keine erhöhten Rechte; läuft vollständig im Benutzerkontext
      • kein Tastaturmitschnitt — die Tastenkombination wird bei Windows angemeldet,
        nicht die Tastatur überwacht

    WO DATEN LIEGEN
    ---------------
      Bausteine und Vorlagen : frei gewählte .tbd-Datei (kann auf einem Netzlaufwerk liegen)
      Einstellungen          : %APPDATA%\DocKit\einstellungen.json
      Programm               : beliebiger Ordner, darf schreibgeschützt sein


    AUFBAU DIESER DATEI
    -------------------
       1. Grundlagen ............ Pfade, Windows-Funktionen (P/Invoke), JSON lesen und schreiben
       2. Textbausteindateien ... Öffnen, Anlegen, Wechseln; Vorlagen benutzen
       3. Textmaschine .......... Platzhalter, Zwischenablage, Einfügen
       4. Formatierter Text ..... RTF: Schrift, Zeilenabstand, Platzhalter im Dokument
       5. Oberfläche ............ gemeinsame Bausteine für alle Fenster
       6. Assistent ............. "Baustein zusammenstellen"
       7. Schnellwahl ........... das Fenster hinter der Tastenkombination
       8. Verwaltung ............ Bausteine und Vorlagen anlegen und bearbeiten
       9. Einstellungen ......... Tastenkombination, Standardschrift, Verhalten
      10. Start ................. Symbol im Infobereich, Hauptschleife


    ZWEI EIGENHEITEN, DIE ABSICHT SIND
    ----------------------------------
    1. Gemeinsame Zustände stehen in $global:, nicht in $script:.
       Grund: Ereignisbehandlungen werden mit .GetNewClosure() erzeugt. Eine Closure
       bekommt einen eigenen Modulbereich — darin zeigt $script: ins Leere, $global:
       dagegen weiterhin auf denselben Wert.

    2. In doppelt zitierten Zeichenketten stehen Guillemets »…«, keine „…".
       Grund: PowerShell behandelt „ (U+201E) als vollwertiges Trennzeichen und
       beendet die Zeichenkette dort. Der Code bleibt gültig, bedeutet aber etwas
       anderes — eine Syntaxprüfung findet das nicht. Näheres in der README.
#>

# =====================================================================
#  1. GRUNDLAGEN
# =====================================================================

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Woher das Programm läuft. Als Skript steckt der Pfad in $PSScriptRoot; steckt das
# Skript dagegen in der DocKit.exe, reicht die Hülle den Ordner herein.
if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $global:ProgrammOrdner = $PSScriptRoot
    $global:BasisOrdner    = Split-Path -Parent $PSScriptRoot
} elseif ($global:DocKitBasis) {
    $global:ProgrammOrdner = [string]$global:DocKitBasis
    $global:BasisOrdner    = [string]$global:DocKitBasis
} else {
    $global:ProgrammOrdner = (Get-Location).Path
    $global:BasisOrdner    = (Get-Location).Path
}
<#
    Die Einstellungen jedes Anwenders liegen in seinem eigenen Profil, nicht neben
    dem Programm: Auf einem Behördenlaufwerk ist der Programmordner in aller Regel
    schreibgeschützt, und jeder Anmeldename braucht ohnehin seine eigenen.

    Die Bausteine selbst stehen in einer frei wählbaren Textbausteindatei. Welche
    zuletzt offen war, merkt sich die Einstellungsdatei.
#>
<#
    Zwei Betriebsarten:

    Fest eingerichtet — die Einstellungen liegen im Benutzerprofil. So hat auf einem
    gemeinsam genutzten Rechner jeder Anmeldename seine eigenen.

    Vom Stick (portabel) — liegt neben dem Programm eine Datei PORTABEL.txt, wandern
    die Einstellungen in den Unterordner "Einstellungen" daneben. Damit reist alles
    mit, und auf dem fremden Rechner bleibt nichts zurück.
#>
$global:Portabel = Test-Path -LiteralPath (Join-Path $global:BasisOrdner 'PORTABEL.txt')
if ($global:Portabel) {
    $global:EinstellOrdner = Join-Path $global:BasisOrdner 'Einstellungen'
} else {
    $global:EinstellOrdner = Join-Path $env:APPDATA 'DocKit'
}
$global:EinstellDatei  = Join-Path $global:EinstellOrdner 'einstellungen.json'
$global:BausteinDatei  = ''                                        # wird beim Start gesetzt
$global:AltDatenOrdner = Join-Path $global:BasisOrdner 'Daten'     # Bestand aus früheren Fassungen
$global:DatenOrdner    = $global:AltDatenOrdner
$global:Dateiendung    = '.tbd'
$global:WeitergabeEndung = '.tbx'                            # einzelne Bausteine zum Weitergeben
$global:Version        = '0.1'

if (-not (Test-Path -LiteralPath $global:EinstellOrdner)) {
    [void](New-Item -ItemType Directory -Path $global:EinstellOrdner -Force)
}

# --- Windows-Funktionen, die WinForms selbst nicht mitbringt --------------------
# RegisterHotKey                          = systemweite Tastenkombination
# SetForegroundWindow + AttachThreadInput = Fokus an das vorherige Fenster zurückgeben

if (-not ('DocKit.Windows' -as [type])) {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DocKit {

    public class Windows {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, string lParam);

        // Grauer Hinweistext, der im leeren Suchfeld steht (EM_SETCUEBANNER).
        public static void Platzhaltertext(IntPtr hWnd, string text) {
            SendMessage(hWnd, 0x1501, (IntPtr)1, text);
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder s, int max);

        [StructLayout(LayoutKind.Sequential)] struct Punkt { public int X; public int Y; }
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Punkt p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint art);

        /// Welches Fenster liegt an dieser Bildschirmstelle? Geliefert wird das
        /// oberste Fenster, nicht das Steuerelement darin — gebraucht beim
        /// Ablegen einer Vorlage im Explorer.
        public static IntPtr FensterUnterPunkt(int x, int y) {
            var p = new Punkt(); p.X = x; p.Y = y;
            IntPtr h = WindowFromPoint(p);
            if (h == IntPtr.Zero) return IntPtr.Zero;
            return GetAncestor(h, 2);   // GA_ROOT
        }

        public static string FensterKlasse(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return "";
            var sb = new System.Text.StringBuilder(200);
            GetClassName(hWnd, sb, 200);
            return sb.ToString();
        }

        public static string FensterTitel(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return "";
            var sb = new System.Text.StringBuilder(300);
            GetWindowText(hWnd, sb, 300);
            return sb.ToString();
        }

        // Holt das angegebene Fenster wieder nach vorn, auch aus einem fremden Prozess.
        public static void FokusZurueck(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return;
            IntPtr vorn  = GetForegroundWindow();
            uint   fremd = GetWindowThreadProcessId(vorn, IntPtr.Zero);
            uint   eigen = GetCurrentThreadId();
            bool   verbunden = false;
            if (fremd != eigen) verbunden = AttachThreadInput(eigen, fremd, true);
            if (IsIconic(hWnd)) ShowWindow(hWnd, 9);   // SW_RESTORE
            SetForegroundWindow(hWnd);
            if (verbunden) AttachThreadInput(eigen, fremd, false);
        }
    }

    // Zeilen- und Absatzabstand eines Rich-Text-Feldes. WinForms bietet dafür nichts an;
    // das Steuerelement versteht aber die Windows-Nachricht EM_SETPARAFORMAT.
    [StructLayout(LayoutKind.Sequential)]
    public struct Absatzformat {
        public int cbSize;
        public uint dwMask;
        public short wNumbering;
        public short wEffects;
        public int dxStartIndent;
        public int dxRightIndent;
        public int dxOffset;
        public short wAlignment;
        public short cTabCount;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public int[] rgxTabs;
        public int dySpaceBefore;
        public int dySpaceAfter;
        public int dyLineSpacing;
        public short sStyle;
        public byte bLineSpacingRule;
        public byte bOutlineLevel;
        public short wShadingWeight;
        public short wShadingStyle;
        public short wNumberingStart;
        public short wNumberingStyle;
        public short wNumberingTab;
        public short wBorderSpace;
        public short wBorderWidth;
        public short wBorders;
    }

    public class Absatz {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, ref Absatzformat pf);

        const int EM_SETPARAFORMAT = 0x0447;
        const int EM_GETPARAFORMAT = 0x0448;
        const uint PFM_LINESPACING = 0x00000100;
        const uint PFM_SPACEAFTER  = 0x00000080;

        static Absatzformat Neu() {
            var pf = new Absatzformat();
            pf.cbSize = Marshal.SizeOf(typeof(Absatzformat));
            pf.rgxTabs = new int[32];
            return pf;
        }

        /// Zeilenabstand als Vielfaches der Zeilenhöhe: 1.0, 1.5, 2.0 …
        /// Regel 5 bedeutet: dyLineSpacing/20 Zeilen.
        public static void ZeilenabstandSetzen(IntPtr hWnd, double faktor, int abstandNachAbsatz) {
            var pf = Neu();
            pf.dwMask = PFM_LINESPACING | PFM_SPACEAFTER;
            pf.bLineSpacingRule = 5;
            pf.dyLineSpacing = (int)Math.Round(faktor * 20.0);
            pf.dySpaceAfter = abstandNachAbsatz;      // in Twips (1/1440 Zoll)
            SendMessage(hWnd, EM_SETPARAFORMAT, IntPtr.Zero, ref pf);
        }

        // Ein Gegenstück zum Lesen gibt es hier bewusst nicht: EM_GETPARAFORMAT
        // meldete in der Erprobung durchgängig "einfacher Abstand" zurück, auch
        // unmittelbar nach dem Setzen. Maßgeblich ist der RTF-Inhalt (\slN).
    }

    // Unsichtbares Fenster, das nur auf die systemweite Tastenkombination lauscht.
    public class Tastenwaechter : NativeWindow, IDisposable {
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        const int WM_HOTKEY = 0x0312;
        int letzteId = 0;

        public event EventHandler Gedrueckt;

        public Tastenwaechter() { CreateHandle(new CreateParams()); }

        public bool Anmelden(uint modifikatoren, uint taste) {
            Abmelden();
            letzteId = 1;
            return RegisterHotKey(this.Handle, letzteId, modifikatoren, taste);
        }

        public void Abmelden() {
            if (letzteId != 0) { UnregisterHotKey(this.Handle, letzteId); letzteId = 0; }
        }

        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_HOTKEY && Gedrueckt != null) Gedrueckt(this, EventArgs.Empty);
            base.WndProc(ref m);
        }

        public void Dispose() { Abmelden(); DestroyHandle(); }
    }

    /*
        Kürzel-Erkennung: löst ein Kürzel wie "#AV" aus, sobald es gefolgt von
        Leerzeichen/Enter/Tab getippt wird — egal in welchem Programm. Technisch
        geht das nur über einen systemweiten Tastatur-Haken (SetWindowsHookEx,
        WH_KEYBOARD_LL) — dieselbe Technik, die Programme wie PhraseExpress
        benutzen. Bewusst abschaltbar und standardmäßig aus (Einstellungen);
        siehe PRUEFUNG.md für die ausführliche Begründung.

        Was diese Klasse NICHT tut: nichts wird aufgezeichnet, gespeichert oder
        irgendwohin gesendet. Es wird nur ein kurzer Zwischenspeicher des zuletzt
        getippten "Worts" geführt (höchstens 40 Zeichen), der bei jeder
        Wortgrenze verworfen wird — ob er zu einem der registrierten Kürzel
        passt, wird sofort geprüft und dann vergessen. Eigene, künstlich per
        SendKeys erzeugte Tastendrücke (beim Löschen und Einfügen) werden über
        das Injected-Flag erkannt und ignoriert, ebenso alles, was innerhalb von
        DocKit selbst getippt wird — sonst würde die Erkennung sich selbst ins
        Gehege kommen.
    */
    public class Kuerzelwaechter : IDisposable {
        delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        struct KBDLLHOOKSTRUCT {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr GetModuleHandle(string lpModuleName);
        [DllImport("user32.dll")]
        static extern bool GetKeyboardState(byte[] lpKeyState);
        [DllImport("user32.dll")]
        static extern uint MapVirtualKey(uint uCode, uint uMapType);
        [DllImport("user32.dll")]
        static extern IntPtr GetKeyboardLayout(uint idThread);
        [DllImport("user32.dll")]
        static extern int ToUnicodeEx(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
            System.Text.StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl);
        [DllImport("user32.dll")]
        static extern short GetKeyState(int nVirtKey);
        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN     = 0x0100;
        const int WM_SYSKEYDOWN  = 0x0104;
        const uint LLKHF_INJECTED = 0x00000010;
        const uint VK_BACK   = 0x08;
        const uint VK_TAB    = 0x09;
        const uint VK_RETURN = 0x0D;
        const uint VK_SPACE  = 0x20;
        const int VK_SHIFT   = 0x10;
        const int VK_CAPITAL = 0x14;
        const int VK_CONTROL = 0x11;
        const int VK_MENU    = 0x12;
        const int maxPuffer  = 40;   // länger als jedes sinnvolle Kürzel

        IntPtr hakenId = IntPtr.Zero;
        HookProc eigenerProc;   // Referenz festhalten — sonst räumt der Müllsammler den Delegaten weg
        System.Text.StringBuilder puffer = new System.Text.StringBuilder();
        System.Collections.Generic.HashSet<string> kuerzel =
            new System.Collections.Generic.HashSet<string>(System.StringComparer.Ordinal);
        readonly System.Collections.Generic.Queue<string> treffer = new System.Collections.Generic.Queue<string>();
        readonly uint eigenePid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;

        // Von PowerShell gepflegt: welche Kürzel gerade auslösen sollen.
        public void KuerzelSetzen(string[] liste) {
            kuerzel = new System.Collections.Generic.HashSet<string>(liste, System.StringComparer.Ordinal);
        }

        // Letzter Systemfehlercode, falls das Anmelden fehlschlug (0 = kein Fehler).
        public int LetzterFehler = 0;

        // Rückgabe: true, wenn der Haken tatsächlich angemeldet ist — entweder
        // schon vorher oder gerade eben. Bei false steht der Grund in LetzterFehler.
        public bool Installieren() {
            if (hakenId != IntPtr.Zero) return true;
            LetzterFehler = 0;
            eigenerProc = Hook;
            using (var modul = System.Diagnostics.Process.GetCurrentProcess().MainModule) {
                hakenId = SetWindowsHookEx(WH_KEYBOARD_LL, eigenerProc, GetModuleHandle(modul.ModuleName), 0);
            }
            if (hakenId == IntPtr.Zero) {
                LetzterFehler = Marshal.GetLastWin32Error();
                return false;
            }
            return true;
        }

        // Ob der Haken gerade angemeldet ist — zum Nachsehen von außen, ohne noch
        // einmal zu versuchen, ihn anzumelden.
        public bool IstAktiv { get { return hakenId != IntPtr.Zero; } }

        public void Entfernen() {
            if (hakenId == IntPtr.Zero) return;
            UnhookWindowsHookEx(hakenId);
            hakenId = IntPtr.Zero;
            lock (treffer) { treffer.Clear(); }
            puffer.Clear();
        }

        // Wird von PowerShell per Timer regelmäßig abgefragt — nie aus dem Haken
        // selbst heraus verarbeitet, der muss sofort zurückkehren.
        public string NaechsterTreffer() {
            lock (treffer) { return treffer.Count > 0 ? treffer.Dequeue() : null; }
        }

        IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
                var daten = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool injiziert = (daten.flags & LLKHF_INJECTED) != 0;
                if (!injiziert && !ImEigenenFenster()) {
                    if (Verarbeiten(daten.vkCode)) return (IntPtr)1;   // Wortgrenze verschlucken — ein Kürzel wurde erkannt
                }
            }
            return CallNextHookEx(hakenId, nCode, wParam, lParam);
        }

        bool ImEigenenFenster() {
            IntPtr vorn = GetForegroundWindow();
            if (vorn == IntPtr.Zero) return false;
            uint pid;
            GetWindowThreadProcessId(vorn, out pid);
            return pid == eigenePid;
        }

        // Die Thread-ID des Vordergrundfensters — dort, wo gerade tatsächlich
        // getippt wird. Wichtig für die Tastaturbelegung (s. u.).
        uint VordergrundThreadId() {
            IntPtr vorn = GetForegroundWindow();
            if (vorn == IntPtr.Zero) return 0;
            uint pid;
            return GetWindowThreadProcessId(vorn, out pid);
        }

        // Rückgabe: true, wenn gerade ein registriertes Kürzel komplett getippt wurde
        // (die Wortgrenze soll dann nicht beim Zielprogramm ankommen). Öffentlich,
        // damit sich die reine Erkennungslogik ohne echten Tastatur-Haken prüfen
        // lässt — ein Haken lässt sich in einem Prüflauf nicht ehrlich simulieren,
        // weil künstlich erzeugte Tastendrücke bewusst ignoriert werden (s. o.).
        public bool Verarbeiten(uint vk) {
            if (vk == VK_BACK) {
                if (puffer.Length > 0) puffer.Length--;
                return false;
            }
            if (vk == VK_SPACE || vk == VK_RETURN || vk == VK_TAB) {
                bool istTreffer = false;
                if (puffer.Length > 0 && kuerzel.Contains(puffer.ToString())) {
                    istTreffer = true;
                    lock (treffer) { treffer.Enqueue(puffer.ToString()); }
                }
                puffer.Clear();
                return istTreffer;
            }
            string zeichen = ZeichenAus(vk);
            if (string.IsNullOrEmpty(zeichen)) {
                // Pfeiltasten, Funktionstasten und Ähnliches: Der Cursor könnte
                // sich bewegt haben, der Zwischenspeicher passt dann nicht mehr
                // zur tatsächlichen Tippstelle — lieber neu anfangen.
                puffer.Clear();
                return false;
            }
            puffer.Append(zeichen);
            if (puffer.Length > maxPuffer) puffer.Remove(0, puffer.Length - maxPuffer);
            return false;
        }

        /// Welches Zeichen die gedrückte Taste unter der aktuellen Tastatur-
        /// belegung erzeugt — mit GetKeyState statt GetKeyboardState, weil
        /// Letzteres innerhalb eines systemweiten Hakens den Umschalt-/AltGr-
        /// Zustand nicht zuverlässig aktuell meldet. Die Belegung wird vom
        /// Vordergrundfenster abgefragt, nicht vom eigenen Thread — sonst
        /// übersetzt DocKit die Taste nach der falschen Belegung, sobald sein
        /// eigener Thread mit einer anderen Ausgangsbelegung gestartet ist als
        /// das Programm, in dem gerade getippt wird.
        string ZeichenAus(uint vk) {
            byte[] zustand = new byte[256];
            if ((GetKeyState(VK_SHIFT) & 0x8000) != 0) zustand[VK_SHIFT] = 0x80;
            if ((GetKeyState(VK_CAPITAL) & 0x0001) != 0) zustand[VK_CAPITAL] = 0x01;
            if ((GetKeyState(VK_CONTROL) & 0x8000) != 0) zustand[VK_CONTROL] = 0x80;
            if ((GetKeyState(VK_MENU) & 0x8000) != 0) zustand[VK_MENU] = 0x80;
            var sb = new System.Text.StringBuilder(8);
            IntPtr layout = GetKeyboardLayout(VordergrundThreadId());
            int n = ToUnicodeEx(vk, MapVirtualKey(vk, 0), zustand, sb, sb.Capacity, 0, layout);
            if (n <= 0) return "";
            return sb.ToString();
        }

        public void Dispose() { Entfernen(); }
    }
}
'@
}

# --- JSON lesen und schreiben (immer UTF-8, damit Umlaute erhalten bleiben) -----

function Lies-Json {
    param([string]$Pfad)
    if (-not (Test-Path -LiteralPath $Pfad)) { return $null }
    $roh = [System.IO.File]::ReadAllText($Pfad, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($roh)) { return $null }
    return ($roh | ConvertFrom-Json)
}

function Schreib-Json {
    param([string]$Pfad, $Objekt)
    $json = $Objekt | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Pfad, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# --- Einstellungen --------------------------------------------------------------

function Standard-Einstellungen {
    [pscustomobject]@{
        hotkey_strg                  = $true
        hotkey_alt                   = $true
        hotkey_umschalt              = $false
        hotkey_windows               = $false
        hotkey_taste                 = 'T'
        automatisch_einfuegen        = $true
        leere_zeilen_aufraeumen      = $true
        zwischenablage_zuruecksetzen = $false
        standard_schriftart          = 'Arial'
        standard_groesse             = 12
        standard_zeilenabstand       = 1.5
        nur_reiner_text              = $false
        aktuelle_datei               = ''      # zuletzt geöffnete Textbausteindatei
        zuletzt_verwendet            = @()     # Liste für den schnellen Wechsel
        letzter_zielordner           = ''      # wohin zuletzt eine Vorlagenkopie ging
        autotext_aktiv               = $false  # Kürzel-Erkennung beim Tippen — bewusst aus, bis eingeschaltet
    }
}

function Lade-Einstellungen {
    # Einstellungen aus früheren Fassungen lagen neben dem Programm — einmalig übernehmen.
    if (-not (Test-Path -LiteralPath $global:EinstellDatei)) {
        $alt = Join-Path $global:AltDatenOrdner 'einstellungen.json'
        if (Test-Path -LiteralPath $alt) {
            try { Copy-Item -LiteralPath $alt -Destination $global:EinstellDatei -Force } catch { }
        }
    }
    $e = Lies-Json $global:EinstellDatei
    $standard = Standard-Einstellungen
    if ($null -eq $e) { return $standard }
    foreach ($p in $standard.PSObject.Properties) {
        if ($null -eq $e.PSObject.Properties[$p.Name]) {
            Add-Member -InputObject $e -MemberType NoteProperty -Name $p.Name -Value $p.Value
        }
    }
    return $e
}

function Speichere-Einstellungen { Schreib-Json $global:EinstellDatei $global:Einstellungen }

# --- Bausteine ------------------------------------------------------------------

function Neues-Feld {
    param([string]$Name = 'Neues Feld', [string]$Typ = 'text')
    [pscustomobject]@{
        name      = $Name
        typ       = $Typ          # text | mehrzeilig | auswahl | datum | uhrzeit | zahl | schalter
        hinweis   = ''
        standard  = ''
        optionen  = @()           # nur bei "auswahl": Liste aus { anzeige, wert }
        wenn_ja   = ''            # nur bei "schalter"
        wenn_nein = ''
        # Abhängige Felder: dieses Feld erscheint im Assistenten nur, wenn das
        # genannte andere Feld auf dem genannten Wert steht. Leer = immer zeigen.
        zeigen_wenn_feld = ''
        zeigen_wenn_wert = ''
    }
}

function Neuer-Baustein {
    param([string]$Kategorie = 'Allgemein')
    [pscustomobject]@{
        id           = [guid]::NewGuid().ToString()
        kategorie    = $Kategorie
        name         = 'Neuer Baustein'
        kuerzel      = ''
        beschreibung = ''
        text         = ''      # reine Textfassung, als Rückfallebene und zum Suchen
        rtf          = ''      # die maßgebliche, formatierte Fassung
        # Löst die Kürzel-Erkennung beim Tippen aus (Abschnitt 3a) — leer heißt:
        # nicht beteiligt. Bewusst ein eigenes Feld, getrennt vom Such-Kürzel
        # oben: Das hier wird beim Tippen in jedem Programm mitgelesen, das
        # Such-Kürzel nie.
        autotext_kuerzel = ''
        # Wer wann — damit in einer gemeinsam gepflegten Datei nachvollziehbar
        # bleibt, wer etwas angelegt und wer es zuletzt geändert hat.
        erstellt_von  = $env:USERNAME
        erstellt_am   = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        geaendert_von = $env:USERNAME
        geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        felder       = (New-Object System.Collections.ArrayList)
    }
}

# Sorgt dafür, dass jeder geladene Baustein alle Eigenschaften besitzt — auch dann,
# wenn die JSON-Datei von Hand bearbeitet und dabei etwas weggelassen wurde.
function Vervollstaendige-Baustein {
    param($B)
    $vorlage = Neuer-Baustein
    foreach ($p in $vorlage.PSObject.Properties) {
        if ($null -eq $B.PSObject.Properties[$p.Name]) {
            Add-Member -InputObject $B -MemberType NoteProperty -Name $p.Name -Value $p.Value
        }
    }
    if ([string]::IsNullOrWhiteSpace($B.id)) { $B.id = [guid]::NewGuid().ToString() }

    # Bausteine aus der Zeit vor der Formatierung bekommen ihre RTF-Fassung
    # in der eingestellten Standardschrift — Arial 12, 1,5 Zeilen.
    if ([string]::IsNullOrWhiteSpace($B.rtf) -and -not [string]::IsNullOrWhiteSpace($B.text)) {
        $B.rtf = Text-Nach-Rtf ([string]$B.text)
    }

    $felder = New-Object System.Collections.ArrayList
    foreach ($f in @($B.felder)) {
        if ($null -eq $f) { continue }
        $fv = Neues-Feld
        foreach ($p in $fv.PSObject.Properties) {
            if ($null -eq $f.PSObject.Properties[$p.Name]) {
                Add-Member -InputObject $f -MemberType NoteProperty -Name $p.Name -Value $p.Value
            }
        }
        $f.optionen = @($f.optionen)
        [void]$felder.Add($f)
    }
    $B.felder = $felder
    return $B
}

<#
    Ein Baustein wird über JSON verdoppelt, nicht über eine Zuweisung: sonst
    zeigten beide auf dieselbe Feldliste, und eine Änderung träfe beide.
    Die Kennung ist neu — zwei Bausteine mit derselben wären nicht zu trennen.
#>
function Kopiere-Baustein {
    param($B)
    $kopie = Vervollstaendige-Baustein ($B | ConvertTo-Json -Depth 12 | ConvertFrom-Json)
    $kopie.id = [guid]::NewGuid().ToString()
    return $kopie
}

<#
    Eine Vorlage ist kein Text, sondern ein Verweis auf eine Datei — den Blanko-
    Briefkopf etwa. Sie steht in derselben Textbausteindatei, damit eine Dienststelle
    Bausteine und Vorlagen gemeinsam pflegen kann.
#>
function Neue-Vorlage {
    param([string]$Pfad = '')
    $name = 'Neue Vorlage'
    if ($Pfad) { $name = [System.IO.Path]::GetFileNameWithoutExtension($Pfad) }
    [pscustomobject]@{
        id           = [guid]::NewGuid().ToString()
        name         = $name
        kategorie    = 'Vorlagen'
        pfad         = [string]$Pfad
        beschreibung = ''
        # Wo in der Kopie ein Textbaustein landen soll. Einmal beim Anlegen festgelegt.
        einfuegen_art   = 'marke'      # marke | textmarke | ende | keine
        einfuegen_marke = '{Textbaustein}'
        oeffnen_danach  = $true
    }
}

function Vervollstaendige-Vorlage {
    param($V)
    $vorlage = Neue-Vorlage
    foreach ($p in $vorlage.PSObject.Properties) {
        if ($null -eq $V.PSObject.Properties[$p.Name]) {
            Add-Member -InputObject $V -MemberType NoteProperty -Name $p.Name -Value $p.Value
        }
    }
    if ([string]::IsNullOrWhiteSpace($V.id)) { $V.id = [guid]::NewGuid().ToString() }
    return $V
}

function Lade-Vorlagen {
    $daten = Lies-Json $global:BausteinDatei
    $liste = New-Object System.Collections.ArrayList
    if ($null -ne $daten -and $null -ne $daten.vorlagen) {
        foreach ($v in @($daten.vorlagen)) {
            if ($null -eq $v) { continue }
            [void]$liste.Add((Vervollstaendige-Vorlage $v))
        }
    }
    return , $liste
}


<#
    Eine Kombination verknüpft eine Vorlage mit einem Baustein unter einem
    gemeinsamen Namen — etwa "Abschlussvermerk" für die Vorlage "Vermerk" mit
    dem gleichnamigen Baustein darin. Referenziert wird über die Kennung, nicht
    über den Namen: Benennt man Vorlage oder Baustein um, bleibt die Kombination
    gültig.
#>
function Neue-Kombination {
    [pscustomobject]@{
        id            = [guid]::NewGuid().ToString()
        name          = 'Neue Kombination'
        kategorie     = 'Allgemein'
        beschreibung  = ''
        vorlage_id    = ''
        bausteine     = (New-Object System.Collections.ArrayList)
        erstellt_von  = $env:USERNAME
        erstellt_am   = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        geaendert_von = $env:USERNAME
        geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    }
}

<#
    Ein einzelner Baustein innerhalb einer Kombination: welcher Baustein es ist
    und wohin er in der Vorlage geschrieben wird. Jeder Eintrag trägt eine
    eigene Kennung, damit sich in der Liste im Kombinationseditor gezielt
    einer davon bearbeiten oder entfernen lässt.
#>
function Neuer-Kombinations-Baustein {
    param([string]$BausteinId = '', [string]$EinfuegenArt = 'marke', [string]$EinfuegenMarke = '{Textbaustein}')
    [pscustomobject]@{
        id              = [guid]::NewGuid().ToString()
        baustein_id     = $BausteinId
        einfuegen_art   = $EinfuegenArt
        einfuegen_marke = $EinfuegenMarke
    }
}

function Vervollstaendige-Kombination {
    param($K)
    $vorlage = Neue-Kombination
    foreach ($p in $vorlage.PSObject.Properties) {
        if ($null -eq $K.PSObject.Properties[$p.Name]) {
            Add-Member -InputObject $K -MemberType NoteProperty -Name $p.Name -Value $p.Value
        }
    }
    if ([string]::IsNullOrWhiteSpace($K.id)) { $K.id = [guid]::NewGuid().ToString() }

    <#
        Fassung 1.1 kannte nur einen einzelnen Baustein (baustein_id) mit der
        Einfügestelle der Vorlage. Wird so eine ältere Kombination geladen,
        wandert er als erster — und einziger — Eintrag in die neue Liste.
    #>
    if (@($K.bausteine).Count -eq 0 -and $K.PSObject.Properties['baustein_id'] -and
        -not [string]::IsNullOrWhiteSpace([string]$K.baustein_id)) {
        $K.bausteine = New-Object System.Collections.ArrayList
        [void]$K.bausteine.Add((Neuer-Kombinations-Baustein -BausteinId ([string]$K.baustein_id)))
    }

    $liste = New-Object System.Collections.ArrayList
    foreach ($b in @($K.bausteine)) {
        if ($null -eq $b) { continue }
        $vorlageEintrag = Neuer-Kombinations-Baustein
        foreach ($p in $vorlageEintrag.PSObject.Properties) {
            if ($null -eq $b.PSObject.Properties[$p.Name]) {
                Add-Member -InputObject $b -MemberType NoteProperty -Name $p.Name -Value $p.Value
            }
        }
        if ([string]::IsNullOrWhiteSpace($b.id)) { $b.id = [guid]::NewGuid().ToString() }
        [void]$liste.Add($b)
    }
    $K.bausteine = $liste
    return $K
}

<#
    Kurzfassung der verknüpften Bausteine einer Kombination für Listenanzeigen:
    die Namen durch Komma getrennt, und ob alle noch vorhanden sind.
#>
function Kombination-Bausteinnamen {
    param($Kombination)
    $namen = New-Object System.Collections.ArrayList
    $vollstaendig = $true
    foreach ($b in @($Kombination.bausteine)) {
        if ($null -eq $b) { continue }
        $baustein = @($global:Bausteine) | Where-Object { $_ -and $_.id -eq $b.baustein_id } | Select-Object -First 1
        if ($null -eq $baustein) { $vollstaendig = $false; continue }
        [void]$namen.Add([string]$baustein.name)
    }
    $text = if ($namen.Count -gt 0) { $namen -join ', ' } else { '— fehlt —' }
    return [pscustomobject]@{ Text = $text; Vollstaendig = ($vollstaendig -and $namen.Count -gt 0) }
}

function Lade-Kombinationen {
    $daten = Lies-Json $global:BausteinDatei
    $liste = New-Object System.Collections.ArrayList
    if ($null -ne $daten -and $null -ne $daten.kombinationen) {
        foreach ($k in @($daten.kombinationen)) {
            if ($null -eq $k) { continue }
            [void]$liste.Add((Vervollstaendige-Kombination $k))
        }
    }
    return , $liste
}

function Lade-Bausteine {
    $daten = Lies-Json $global:BausteinDatei
    $liste = New-Object System.Collections.ArrayList
    if ($null -ne $daten -and $null -ne $daten.bausteine) {
        foreach ($b in @($daten.bausteine)) { [void]$liste.Add((Vervollstaendige-Baustein $b)) }
    }
    # Das Komma verhindert, dass PowerShell die Liste beim Zurückgeben in ein
    # Array mit fester Größe auflöst — sonst ließe sich später nichts hinzufügen.
    return , $liste
}

function Speichere-Bausteine {
    # Sicherungskopie der letzten Fassung, bevor überschrieben wird. Schlägt das
    # fehl — etwa auf einem schreibgeschützten Laufwerk —, ist das kein Grund,
    # das Speichern selbst abzubrechen.
    if (Test-Path -LiteralPath $global:BausteinDatei) {
        try { Copy-Item -LiteralPath $global:BausteinDatei -Destination "$($global:BausteinDatei).sicherung" -Force } catch { }
    }
    $daten = [pscustomobject]@{
        version       = 1
        gespeichert   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        bausteine     = @($global:Bausteine)
        vorlagen      = @($global:Vorlagen)
        kombinationen = @($global:Kombinationen)
    }
    Schreib-Json $global:BausteinDatei $daten
    Aktualisiere-Autotext-Kuerzel
}

# =====================================================================
#  2. TEXTBAUSTEINDATEIEN
# =====================================================================

<#
    Die Bausteine stehen nicht mehr an einem festen Ort, sondern in einer Datei,
    die der Anwender selbst wählt. Damit kann eine Dienststelle eine gemeinsame
    Datei auf einem Laufwerk pflegen, während jeder daneben seine eigene führt —
    und im laufenden Betrieb zwischen beiden wechselt.
#>

function Dateiname-Kurz {
    param([string]$Pfad)
    if ([string]::IsNullOrWhiteSpace($Pfad)) { return '(keine Datei)' }
    return [System.IO.Path]::GetFileNameWithoutExtension($Pfad)
}

# Die Handvoll Bausteine, mit denen eine frische Datei beginnt.
function Beispiel-Bausteine {
    $liste = New-Object System.Collections.ArrayList

    $b1 = Neuer-Baustein -Kategorie 'Textschnipsel'
    $b1.name = 'Grußformel'; $b1.kuerzel = 'mfg'
    $b1.beschreibung = 'Mit freundlichen Grüßen, mit deinem Anmeldenamen'
    $b1.text = "Mit freundlichen Grüßen`r`n`r`n{benutzer}"
    [void]$liste.Add($b1)

    $b2 = Neuer-Baustein -Kategorie 'Textschnipsel'
    $b2.name = 'Heutiges Datum'; $b2.kuerzel = 'dat'
    $b2.beschreibung = 'Fügt das heutige Datum ein, ohne Nachfrage'
    $b2.text = '{heute}'
    [void]$liste.Add($b2)

    $b3 = Neuer-Baustein -Kategorie 'Schreiben'
    $b3.name = 'Anschreiben mit Anrede'; $b3.kuerzel = 'anschreiben'
    $b3.beschreibung = 'Zeigt Auswahlfeld, Textfeld und Datum im Zusammenspiel'
    $b3.text = "{Anrede} {Nachname},`r`n`r`nich beziehe mich auf Ihr Schreiben vom {Eingang}.`r`n`r`nMit freundlichen Grüßen`r`n`r`n{benutzer}"
    $fAnrede = Neues-Feld 'Anrede' 'auswahl'
    $fAnrede.hinweis = 'Links steht, was du siehst — rechts, was eingefügt wird.'
    $fAnrede.standard = 'Herr'
    $fAnrede.optionen = @(
        [pscustomobject]@{ anzeige = 'Herr'; wert = 'Sehr geehrter Herr' },
        [pscustomobject]@{ anzeige = 'Frau'; wert = 'Sehr geehrte Frau' },
        [pscustomobject]@{ anzeige = 'Damen und Herren'; wert = 'Sehr geehrte Damen und Herren' }
    )
    $fName = Neues-Feld 'Nachname' 'text'
    $fName.hinweis = 'Bei „Damen und Herren" leer lassen.'
    $fDatum = Neues-Feld 'Eingang' 'datum'
    $fDatum.standard = 'heute'
    [void]$b3.felder.Add($fAnrede); [void]$b3.felder.Add($fName); [void]$b3.felder.Add($fDatum)
    [void]$liste.Add($b3)

    $b4 = Neuer-Baustein -Kategorie 'Textschnipsel'
    $b4.name = 'Zum Ausprobieren: Ja/Nein-Block'; $b4.kuerzel = 'test'
    $b4.beschreibung = 'Ein Absatz, der sich an- und abwählen lässt — ruhig löschen'
    $b4.text = "Sachstand: {Stand}`r`n`r`n{Zusatz}"
    $fStand = Neues-Feld 'Stand' 'mehrzeilig'
    $fZusatz = Neues-Feld 'Zusatz' 'schalter'
    $fZusatz.hinweis = 'Blendet einen ganzen Absatz ein oder aus.'
    $fZusatz.standard = 'ja'
    $fZusatz.wenn_ja = 'Für Rückfragen stehe ich gern zur Verfügung.'
    [void]$b4.felder.Add($fStand); [void]$b4.felder.Add($fZusatz)
    [void]$liste.Add($b4)

    foreach ($b in $liste) { $b.rtf = Text-Nach-Rtf ([string]$b.text) }
    return , $liste
}

# Schreibt eine neue, leere Textbausteindatei mit den Beispielen hinein.
function Erzeuge-Bausteindatei {
    param([string]$Pfad)
    $ordner = Split-Path -Parent $Pfad
    if ($ordner -and -not (Test-Path -LiteralPath $ordner)) {
        [void](New-Item -ItemType Directory -Path $ordner -Force)
    }
    # Erst zuweisen, dann einpacken: Beispiel-Bausteine gibt die Liste mit
    # vorangestelltem Komma zurück, damit sie nicht zerfällt. Ein @( ) direkt um
    # den Aufruf würde genau diese Hülle als einzigen Eintrag behalten.
    $beispiele = Beispiel-Bausteine
    $daten = [pscustomobject]@{
        version     = 1
        gespeichert = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        bausteine   = @($beispiele)
    }
    Schreib-Json $Pfad $daten
}

# Führt die Liste für den schnellen Wechsel nach; die zuletzt benutzte steht oben.
function Merke-Datei {
    param([string]$Pfad)
    $global:Einstellungen.aktuelle_datei = $Pfad
    $liste = New-Object System.Collections.ArrayList
    [void]$liste.Add($Pfad)
    foreach ($alt in @($global:Einstellungen.zuletzt_verwendet)) {
        if ([string]::IsNullOrWhiteSpace($alt)) { continue }
        if ($alt -eq $Pfad) { continue }
        if ($liste.Count -ge 8) { break }
        [void]$liste.Add([string]$alt)
    }
    $global:Einstellungen.zuletzt_verwendet = @($liste)
    Speichere-Einstellungen
}

<#
    Öffnet eine Textbausteindatei und macht sie zur laufenden. Gibt $true zurück,
    wenn es geklappt hat. Fehlt die Datei, sagt das Programm das und lässt die
    bisherige stehen, statt still mit leerer Liste weiterzulaufen.
#>
function Oeffne-Bausteindatei {
    param([string]$Pfad, [switch]$Leise)

    if ([string]::IsNullOrWhiteSpace($Pfad)) { return $false }
    if (-not (Test-Path -LiteralPath $Pfad)) {
        if (-not $Leise) {
            Zeige-Meldung "Die Textbausteindatei wurde nicht gefunden:`r`n`r`n$Pfad`r`n`r`nLiegt sie auf einem Laufwerk, das gerade nicht verbunden ist?" 'Datei nicht gefunden' 'Warning'
        }
        return $false
    }

    $vorherigeDatei = $global:BausteinDatei
    $global:BausteinDatei = $Pfad
    try {
        $global:Bausteine     = Lade-Bausteine
        $global:Vorlagen      = Lade-Vorlagen
        $global:Kombinationen = Lade-Kombinationen
    } catch {
        $global:BausteinDatei = $vorherigeDatei
        if (-not $Leise) {
            Zeige-Meldung "Die Datei konnte nicht gelesen werden:`r`n`r`n$Pfad`r`n`r`n$($_.Exception.Message)" 'Datei fehlerhaft' 'Error'
        }
        return $false
    }

    $global:DatenOrdner = Split-Path -Parent $Pfad

    <#
        Darf in diese Datei geschrieben werden? Das entscheidet Windows über die
        Rechte am Laufwerk, nicht dieses Programm. Eine gemeinsame Datei der
        Dienststelle wird üblicherweise so gesetzt, dass nur die Pflegenden
        schreiben dürfen — dann läuft DocKit hier im Nur-Lesen-Betrieb.
    #>
    $global:NurLesen = $false
    try {
        $strom = [System.IO.File]::Open($Pfad, 'Open', 'ReadWrite', 'None')
        $strom.Close()
    } catch { $global:NurLesen = $true }

    Merke-Datei $Pfad
    if ($global:Tray) { $global:Tray.Text = "DocKit — $(Dateiname-Kurz $Pfad)" }
    Aktualisiere-Autotext-Kuerzel
    return $true
}

<#
    Was mit einer Vorlage geschehen kann. Der Regelfall ist die Zwischenablage:
    Die Datei liegt danach wie ein kopiertes Dokument bereit und lässt sich mit
    Strg+V in jedem Ordner ablegen — oder in Outlook als Anhang einfügen.
#>
function Vorlage-Fehlt-Meldung {
    param($Vorlage)
    Zeige-Meldung ("Die Vorlagendatei ist nicht erreichbar:`r`n`r`n$($Vorlage.pfad)`r`n`r`n" +
        'Wurde sie verschoben oder liegt sie auf einem Laufwerk, das gerade nicht verbunden ist?') 'Vorlage nicht gefunden' 'Warning'
}

<#
    Schreibt einen oder mehrere fertige Textbausteine in eine kopierte
    Word-Datei — jeden an seine eigene Stelle. Word bleibt dafür einmal
    geöffnet, bis alle Einträge abgearbeitet sind; das erspart einen
    erneuten Word-Start je Baustein und stellt sicher, dass entweder alle
    Einfügungen in derselben Kopie landen oder — bei einer einzelnen
    misslungenen Vorlage — gar keine.

    Übergeben wird jeder Baustein als RTF über die Zwischenablage und mit
    Einfügen abgelegt; nur so bleiben Schriftart, Fettung und Zeilenabstand
    erhalten. Weil jeder Eintrag einen eigenen Inhalt hat, wird die
    Zwischenablage vor jedem einzelnen Einfügen neu belegt.

    $Eintraege: Liste von Objekten mit Rtf, Klartext, EinfuegenArt, EinfuegenMarke.

    Rückgabe: ein Objekt mit Fehler (leer bei vollständigem Erfolg, sonst eine
    verständliche Meldung) und Offen (ob die Kopie durch »danach öffnen« schon
    sichtbar in Word steht — der Aufrufer muss sie dann nicht selbst noch
    einmal öffnen). Findet sich für einen von mehreren Einträgen keine Stelle,
    werden die übrigen trotzdem geschrieben und nur der eine fehlende gemeldet.
#>
function Schreibe-Bausteine-In-Dokument {
    param([string]$Zieldatei, $Vorlage, $Eintraege)

    $wortart = [Type]::GetTypeFromProgID('Word.Application')
    if ($null -eq $wortart) {
        return [pscustomobject]@{
            Fehler = 'Auf diesem Rechner ist kein Word eingerichtet. Die Kopie wurde angelegt, der Baustein liegt in der Zwischenablage.'
            Offen  = $false
        }
    }

    $word = $null
    $dok  = $null
    $nichtGefunden = New-Object System.Collections.ArrayList
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $dok = $word.Documents.Open($Zieldatei)

        foreach ($e in @($Eintraege)) {
            if (-not (Setze-Zwischenablage -Text $e.Klartext -Rtf $e.Rtf)) {
                [void]$nichtGefunden.Add('Die Zwischenablage ließ sich nicht belegen.')
                continue
            }

            $eingefuegt = $false
            switch ([string]$e.EinfuegenArt) {

                'textmarke' {
                    $name = [string]$e.EinfuegenMarke
                    if ($dok.Bookmarks.Exists($name)) {
                        $dok.Bookmarks.Item($name).Range.Select()
                        $word.Selection.Paste()
                        $eingefuegt = $true
                    }
                }

                'ende' {
                    $bereich = $dok.Content
                    [void]$bereich.InsertParagraphAfter()
                    $bereich = $dok.Content
                    $bereich.Collapse(0)          # wdCollapseEnd
                    $bereich.Select()
                    $word.Selection.Paste()
                    $eingefuegt = $true
                }

                default {
                    # Marke im Text suchen und durch den Baustein ersetzen
                    $marke = [string]$e.EinfuegenMarke
                    if ([string]::IsNullOrWhiteSpace($marke)) { $marke = '{Textbaustein}' }
                    $suche = $dok.Content
                    if ($suche.Find.Execute($marke)) {
                        $suche.Select()
                        $word.Selection.Paste()
                        $eingefuegt = $true
                    }
                }
            }

            if (-not $eingefuegt) {
                $hinweis = switch ([string]$e.EinfuegenArt) {
                    'textmarke' { "die Textmarke »$($e.EinfuegenMarke)«" }
                    default     { "die Marke »$($e.EinfuegenMarke)«" }
                }
                [void]$nichtGefunden.Add("In der Vorlage gibt es $hinweis nicht.")
            }
        }

        $erfolge = @($Eintraege).Count - $nichtGefunden.Count
        if ($erfolge -le 0) {
            $dok.Close(0)      # wdDoNotSaveChanges
            $word.Quit()
            $grund = if ($nichtGefunden.Count -gt 0) { $nichtGefunden -join "`r`n" } else { 'Unbekannter Grund.' }
            return [pscustomobject]@{
                Fehler = "$grund Die Kopie wurde angelegt, der Baustein liegt in der Zwischenablage."
                Offen  = $false
            }
        }

        $dok.Save()
        $offen = [bool]$Vorlage.oeffnen_danach
        if ($offen) {
            $word.Visible = $true
            [void]$word.Activate()
        } else {
            $dok.Close(-1)     # wdSaveChanges
            $word.Quit()
        }

        $fehler = if ($nichtGefunden.Count -gt 0) { ($nichtGefunden -join "`r`n") + "`r`n`r`nDie übrigen Bausteine wurden geschrieben." } else { '' }
        return [pscustomobject]@{ Fehler = $fehler; Offen = $offen }
    }
    catch {
        try { if ($dok) { $dok.Close(0) } } catch { }
        try { if ($word) { $word.Quit() } } catch { }
        return [pscustomobject]@{ Fehler = "Word meldet: $($_.Exception.Message)"; Offen = $false }
    }
    finally {
        foreach ($o in @($dok, $word)) {
            if ($o) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
        }
    }
}

<#
    Welcher Ordner war offen, als die Tastenkombination gedrückt wurde?

    Windows kennt die geöffneten Explorer-Fenster über Shell.Application. Gesucht
    wird dasjenige, dessen Fensterkennung mit dem gemerkten Vordergrundfenster
    übereinstimmt — so trifft es genau den Ordner, den der Anwender vor Augen hatte.
    Leerer Rückgabewert heißt: Es war kein Ordnerfenster.
#>
function Hole-Explorer-Ordner {
    param([IntPtr]$Fenster)
    if ($Fenster -eq [IntPtr]::Zero) { return '' }

    # Der Schreibtisch zählt auch als Ordner.
    $klasse = [DocKit.Windows]::FensterKlasse($Fenster)
    if ($klasse -eq 'Progman' -or $klasse -eq 'WorkerW') {
        return [Environment]::GetFolderPath('Desktop')
    }

    $shell = $null
    try {
        $shell = New-Object -ComObject Shell.Application
        $gesucht = [int64]$Fenster
        foreach ($f in $shell.Windows()) {
            try {
                if ([int64]$f.HWND -ne $gesucht) { continue }
                $ordner = $f.Document.Folder.Self.Path
                if ($ordner -and (Test-Path -LiteralPath $ordner -PathType Container)) { return $ordner }
            } catch { }
        }
    } catch { }
    finally { if ($shell) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch { } } }
    return ''
}

<#
    Fragt nur nach dem Dateinamen. Der Ordner steht fest und wird angezeigt —
    ein Feld zum Heraussuchen des Pfades wäre genau die Arbeit, die wegfallen soll.
    Rückgabe: vollständiger Pfad, oder '' bei Abbruch.
#>
function Frage-Dateiname {
    param([string]$Ordner, [string]$Vorschlag, [string]$Endung, [string]$Titel = 'Vorlage ablegen')

    $fenster = Neues-Fenster -Titel $Titel -Breite 600 -Hoehe 260 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false
    $fenster.TopMost = $true

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $lOrdner = Neue-Beschriftung -Text 'Wird abgelegt in' -Fett
    $pOrdner = Neue-Beschriftung -Text $Ordner -Klein
    $pOrdner.MaximumSize = New-Object System.Drawing.Size(540, 0)
    $lName = Neue-Beschriftung -Text 'Wie soll die Datei heißen?' -Fett
    $eName = Neues-Eingabefeld -Breite 540
    $eName.Anchor = 'Top,Left,Right'
    $eName.Text = $Vorschlag
    $hName = Neue-Beschriftung -Text "Die Endung $Endung wird angehängt." -Klein

    $y = 18
    Setze-Unter $flaeche $lOrdner ([ref]$y) 20 2
    Setze-Unter $flaeche $pOrdner ([ref]$y) 20 16
    Setze-Unter $flaeche $lName   ([ref]$y) 20 3
    Setze-Unter $flaeche $eName   ([ref]$y) 20 3
    Setze-Unter $flaeche $hName   ([ref]$y) 20 10

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 56; $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk    = Neuer-Knopf -Text 'Hier anlegen' -Breite 150 -Betont
    $knopfWo    = Neuer-Knopf -Text 'Anderer Ordner …' -Breite 150
    $knopfAus   = Neuer-Knopf -Text 'Abbrechen' -Breite 110
    foreach ($k in @($knopfOk, $knopfWo, $knopfAus)) { $k.Anchor = 'Top,Right' }
    $fuss.Controls.AddRange(@($knopfOk, $knopfWo, $knopfAus))
    $fenster.Controls.Add($fuss)
    $fenster.ClientSize = New-Object System.Drawing.Size(584, ($hName.Bottom + 18 + $fuss.Height))

    $global:DateinameErgebnis = ''

    $bilde = {
        $n = $eName.Text.Trim()
        if (-not $n) { return '' }
        if ($Endung -and -not $n.ToLower().EndsWith($Endung.ToLower())) { $n += $Endung }
        return (Join-Path $Ordner $n)
    }.GetNewClosure()

    $knopfOk.Add_Click({
        $ziel = & $bilde
        if (-not $ziel) { Zeige-Meldung 'Bitte einen Dateinamen eingeben.' 'Name fehlt' 'Warning'; return }
        if (Test-Path -LiteralPath $ziel) {
            if (-not (Frage-Ja-Nein "Es gibt dort schon eine Datei mit diesem Namen.`r`n`r`nSoll sie überschrieben werden?" 'Datei vorhanden')) { return }
        }
        $global:DateinameErgebnis = $ziel
        $fenster.Close()
    }.GetNewClosure())

    $knopfWo.Add_Click({
        $d = New-Object System.Windows.Forms.SaveFileDialog
        $d.Title = 'Ablegen unter'
        $d.Filter = "Vorlagendatei (*$Endung)|*$Endung|Alle Dateien (*.*)|*.*"
        if ($Endung) { $d.DefaultExt = $Endung.TrimStart('.'); $d.AddExtension = $true }
        $d.FileName = $eName.Text.Trim()
        $d.InitialDirectory = $Ordner
        $d.OverwritePrompt = $true
        if ($d.ShowDialog() -eq 'OK') {
            $global:DateinameErgebnis = $d.FileName
            $fenster.Close()
        }
    }.GetNewClosure())

    $knopfAus.Add_Click({ $global:DateinameErgebnis = ''; $fenster.Close() }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfWo.Location  = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfWo.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfWo.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({
        & $ordne
        [DocKit.Windows]::FokusZurueck($fenster.Handle)
        [void]$eName.Focus()
        $punkt = $eName.Text.LastIndexOf('.')
        if ($punkt -gt 0) { $eName.Select(0, $punkt) } else { $eName.SelectAll() }
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:DateinameErgebnis
}

function Vorlage-Ordner-Zeigen {
    param($Vorlage)
    if (-not (Test-Path -LiteralPath $Vorlage.pfad)) { Vorlage-Fehlt-Meldung $Vorlage; return }
    Start-Process 'explorer.exe' -ArgumentList "/select,`"$($Vorlage.pfad)`""
}

<#
    Holt die erste Seite einer Word-Datei als Bild — ganz ohne ein sichtbares
    Word-Fenster. Word öffnet die Datei schreibgeschützt im Hintergrund und
    liefert die Seite als Vektorgrafik (EMF); dadurch bleibt sie auch beim
    Vergrößern des Vorschaufensters scharf, statt zu verpixeln.

    Läuft in einem eigenen try/catch/finally, damit bei jedem Fehler
    WINWORD.EXE zuverlässig beendet wird — sonst bliebe ein unsichtbarer
    Word-Prozess hängen, den der Anwender nirgends sieht.
#>
function Rendere-Wort-Vorschau {
    param([string]$Pfad)
    if ($null -eq [Type]::GetTypeFromProgID('Word.Application')) { return $null }
    $word = $null; $dok = $null
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.ScreenUpdating = $false
        $dok = $word.Documents.Open($Pfad, $false, $true, $false)
        $bytes = [byte[]]$dok.Windows.Item(1).Panes.Item(1).Pages.Item(1).EnhMetaFileBits
        $dok.Close(0)
        $word.Quit()
        if ($null -eq $bytes -or $bytes.Length -eq 0) { return $null }
        return (New-Object System.Drawing.Imaging.Metafile((New-Object System.IO.MemoryStream(, $bytes))))
    } catch {
        try { if ($dok) { $dok.Close(0) } } catch { }
        try { if ($word) { $word.Quit() } } catch { }
        return $null
    } finally {
        foreach ($o in @($dok, $word)) {
            if ($o) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
        }
    }
}

<#
    Dasselbe für Excel: das benutzte Zellfeld des ersten Blatts als Bild, über
    die Zwischenablage geholt (CopyPicture kennt keinen anderen Weg). Der
    vorherige Zwischenablageinhalt wird davor gesichert und danach wieder
    hergestellt — die Vorschau soll nichts überschreiben, was der Anwender
    vorher kopiert hat.
#>
function Rendere-Excel-Vorschau {
    param([string]$Pfad)
    if ($null -eq [Type]::GetTypeFromProgID('Excel.Application')) { return $null }
    $vorherigeZwischenablage = $null
    try { $vorherigeZwischenablage = [System.Windows.Forms.Clipboard]::GetDataObject() } catch { }
    $excel = $null; $mappe = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.ScreenUpdating = $false
        $excel.DisplayAlerts = $false
        $mappe = $excel.Workbooks.Open($Pfad, $false, $true)
        $mappe.Worksheets.Item(1).UsedRange.CopyPicture(1, 2)   # xlScreen, xlBitmap
        Start-Sleep -Milliseconds 200
        $bild = $null
        if ([System.Windows.Forms.Clipboard]::ContainsImage()) { $bild = [System.Windows.Forms.Clipboard]::GetImage() }
        $mappe.Close($false)
        $excel.Quit()
        return $bild
    } catch {
        try { if ($mappe) { $mappe.Close($false) } } catch { }
        try { if ($excel) { $excel.Quit() } } catch { }
        return $null
    } finally {
        foreach ($o in @($mappe, $excel)) {
            if ($o) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
        }
        try { if ($vorherigeZwischenablage) { [System.Windows.Forms.Clipboard]::SetDataObject($vorherigeZwischenablage, $true) } } catch { }
    }
}

<#
    Zeigt eine Vorlage in einem eigenen Fenster innerhalb von DocKit — ohne
    dass dafür Word, Excel oder ein anderes Programm sichtbar aufgeht. Word-
    und Excel-Dateien werden dazu unsichtbar im Hintergrund geöffnet und nur
    die erste Seite als Bild geholt; Bilder lassen sich ohnehin direkt zeigen.

    Für alles andere — oder wenn das Rendern fehlschlägt — gibt es im
    Vorschaufenster einen Knopf, der die Datei stattdessen in ihrem gewohnten
    Programm öffnet, auf einer schreibgeschützten Kopie in %TEMP%. So bleibt
    die Ursprungsdatei in jedem Fall unangetastet.
#>
function Zeige-Vorlage-Vorschau {
    param($Vorlage)
    if (-not (Test-Path -LiteralPath $Vorlage.pfad)) { Vorlage-Fehlt-Meldung $Vorlage; return }

    $pfad = [string]$Vorlage.pfad
    $endung = ([System.IO.Path]::GetExtension($pfad)).ToLowerInvariant()
    $wortEndungen  = @('.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf')
    $excelEndungen = @('.xls', '.xlsx', '.xlsm', '.xlsb')
    $bildEndungen  = @('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff')
    $istWort = $wortEndungen -contains $endung

    [System.Windows.Forms.Cursor]::Current = [System.Windows.Forms.Cursors]::WaitCursor
    $bild = $null; $text = $null
    try {
        if ($istWort) {
            $bild = Rendere-Wort-Vorschau $pfad
        } elseif ($excelEndungen -contains $endung) {
            $bild = Rendere-Excel-Vorschau $pfad
        } elseif ($bildEndungen -contains $endung) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($pfad)
                $bild = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))
            } catch { $bild = $null }
        } elseif ($endung -eq '.txt') {
            try { $text = [System.IO.File]::ReadAllText($pfad) } catch { $text = $null }
        }
    } finally {
        [System.Windows.Forms.Cursor]::Current = [System.Windows.Forms.Cursors]::Default
    }

    $fenster = Neues-Fenster -Titel "Vorschau — $($Vorlage.name)" -Breite 760 -Hoehe 880

    $inhalt = $null
    if ($null -ne $bild) {
        $inhalt = New-Object System.Windows.Forms.PictureBox
        $inhalt.Dock = 'Fill'; $inhalt.SizeMode = 'Zoom'; $inhalt.BackColor = $global:Farbe.Hintergrund
        $inhalt.Image = $bild
    } elseif ($null -ne $text) {
        $inhalt = New-Object System.Windows.Forms.TextBox
        $inhalt.Dock = 'Fill'; $inhalt.Multiline = $true; $inhalt.ReadOnly = $true
        $inhalt.ScrollBars = 'Vertical'; $inhalt.Font = $global:SchriftFest
        $inhalt.BorderStyle = 'None'; $inhalt.BackColor = $global:Farbe.Flaeche
        $inhalt.Text = $text
    } else {
        $inhalt = New-Object System.Windows.Forms.Panel
        $inhalt.Dock = 'Fill'; $inhalt.BackColor = $global:Farbe.Flaeche
        $hinweisLabel = Neue-Beschriftung -Text ("Für dieses Dateiformat gibt es keine eingebaute Vorschau.`r`n`r`n" +
            'Über »In eigenem Programm öffnen« lässt sich die Datei trotzdem ansehen — auf einer ' +
            'schreibgeschützten Kopie, die Ursprungsdatei bleibt unangetastet.') -Grau
        $hinweisLabel.MaximumSize = New-Object System.Drawing.Size(600, 0)
        $hinweisLabel.Location = New-Object System.Drawing.Point(24, 24)
        $inhalt.Controls.Add($hinweisLabel)
    }
    $fenster.Controls.Add($inhalt)

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 54; $fuss.BackColor = $global:Farbe.Flaeche
    $knopfOeffnen    = Neuer-Knopf -Text 'In eigenem Programm öffnen' -Breite 220
    $knopfSchliessen = Neuer-Knopf -Text 'Schließen' -Breite 120 -Betont
    $knopfOeffnen.Anchor = 'Top,Right'; $knopfSchliessen.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOeffnen, $knopfSchliessen))
    $fenster.Controls.Add($fuss)

    if ($null -ne $bild -and $istWort) {
        $hinweis = New-Object System.Windows.Forms.Panel
        $hinweis.Dock = 'Top'; $hinweis.Height = 28; $hinweis.BackColor = $global:Farbe.AkzentHell
        $hinweisText = Neue-Beschriftung -Text 'Nur die erste Seite — für das ganze Dokument bitte öffnen.' -Klein
        $hinweisText.ForeColor = $global:Farbe.Akzent
        $hinweisText.Location = New-Object System.Drawing.Point(12, 6)
        $hinweis.Controls.Add($hinweisText)
        $fenster.Controls.Add($hinweis)
    }

    $knopfOeffnen.Add_Click({
        try {
            $ordner = Join-Path $env:TEMP ('DocKit-Vorschau\' + [guid]::NewGuid().ToString('N').Substring(0, 8))
            [void](New-Item -ItemType Directory -Path $ordner -Force)
            $ziel = Join-Path $ordner ([System.IO.Path]::GetFileName($pfad))
            Copy-Item -LiteralPath $pfad -Destination $ziel -Force
            Set-ItemProperty -LiteralPath $ziel -Name IsReadOnly -Value $true
            Start-Process -FilePath $ziel
        } catch {
            Zeige-Meldung "Die Datei ließ sich nicht öffnen:`r`n`r`n$($_.Exception.Message)" 'Öffnen fehlgeschlagen' 'Error'
        }
    }.GetNewClosure())
    $knopfSchliessen.Add_Click({ $fenster.Close() }.GetNewClosure())

    $ordne = {
        $knopfSchliessen.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfSchliessen.Width), 10)
        $knopfOeffnen.Location    = New-Object System.Drawing.Point(($knopfSchliessen.Left - 10 - $knopfOeffnen.Width), 10)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown($ordne)

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    if ($bild) { $bild.Dispose() }
}

function Frage-Bausteindatei-Oeffnen {
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Title = 'Textbausteindatei öffnen'
    $d.Filter = "Textbausteindateien (*$($global:Dateiendung))|*$($global:Dateiendung)|Alle Dateien (*.*)|*.*"
    $d.CheckFileExists = $true
    if ($global:Einstellungen.aktuelle_datei -and (Test-Path -LiteralPath $global:Einstellungen.aktuelle_datei)) {
        $d.InitialDirectory = Split-Path -Parent $global:Einstellungen.aktuelle_datei
    }
    if ($d.ShowDialog() -eq 'OK') { return $d.FileName }
    return ''
}

function Frage-Bausteindatei-Neu {
    $d = New-Object System.Windows.Forms.SaveFileDialog
    $d.Title = 'Neue Textbausteindatei anlegen'
    $d.Filter = "Textbausteindateien (*$($global:Dateiendung))|*$($global:Dateiendung)"
    $d.DefaultExt = $global:Dateiendung.TrimStart('.')
    $d.AddExtension = $true
    $d.FileName = 'Meine Textbausteine' + $global:Dateiendung
    $d.OverwritePrompt = $true
    $d.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
    if ($d.ShowDialog() -eq 'OK') { return $d.FileName }
    return ''
}


<#
    --- Bausteine weitergeben ---

    Ein Baustein soll den Weg zu einem Kollegen finden, ohne dass beide dieselbe
    Datei benutzen müssen. Dafür gibt es eine kleine Datei mit der Endung .tbx:
    derselbe Aufbau wie eine Textbausteindatei, nur mit einem Vermerk, wer sie
    wann erzeugt hat. Sie lässt sich an eine Mail hängen, auf ein Laufwerk legen
    oder aus DocKit heraus direkt in einen Ordner ziehen.

    Beim Übernehmen bekommt jeder Baustein eine neue Kennung. Sonst hätten zwei
    Bausteine in derselben Datei dieselbe — und das Löschen träfe den falschen.
#>

function Schreib-Weitergabe {
    param($Bausteine, [string]$Pfad)
    $daten = [pscustomobject]@{
        version   = 1
        art       = 'weitergabe'
        erzeugt   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        von       = $env:USERNAME
        bausteine = @($Bausteine)
    }
    Schreib-Json $Pfad $daten
}

# Liest eine Weitergabedatei oder eine ganze Textbausteindatei. Beide haben den
# Eintrag "bausteine" — deshalb kann hier beides hereingereicht werden.
function Lies-Weitergabe {
    param([string]$Pfad)
    if ([string]::IsNullOrWhiteSpace($Pfad) -or -not (Test-Path -LiteralPath $Pfad)) { return $null }
    $daten = Lies-Json $Pfad
    if ($null -eq $daten -or $null -eq $daten.bausteine) { return $null }
    $liste = New-Object System.Collections.ArrayList
    foreach ($b in @($daten.bausteine)) {
        if ($null -eq $b) { continue }
        [void]$liste.Add((Vervollstaendige-Baustein $b))
    }
    return [pscustomobject]@{
        Bausteine = $liste
        Von       = [string]$daten.von
        Erzeugt   = [string]$daten.erzeugt
        Pfad      = $Pfad
    }
}

# Ein Dateiname, den man in einer Mail wiedererkennt. Zeichen, die Windows in
# Dateinamen nicht erlaubt, werden durch einen Bindestrich ersetzt.
function Weitergabe-Dateiname {
    param($Bausteine)
    $liste = @($Bausteine)
    if ($liste.Count -eq 1) {
        $name = [string]$liste[0].name
        foreach ($z in [System.IO.Path]::GetInvalidFileNameChars()) { $name = $name.Replace($z, '-') }
        $name = $name.Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Baustein' }
        if ($name.Length -gt 60) { $name = $name.Substring(0, 60).Trim() }
        return "$name$($global:WeitergabeEndung)"
    }
    return "$($liste.Count) Bausteine$($global:WeitergabeEndung)"
}

<#
    Legt die Weitergabedatei in einem eigenen Ordner unter %TEMP% ab. Von dort
    holt Windows sie beim Ziehen und beim Einfügen aus der Zwischenablage.
    Jeder Vorgang bekommt einen eigenen Unterordner, damit gleichnamige Dateien
    einander nicht überschreiben.
#>
function Erzeuge-Weitergabe-Temp {
    param($Bausteine)
    $ordner = Join-Path $env:TEMP ('DocKit-Weitergabe\' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    [void](New-Item -ItemType Directory -Path $ordner -Force)
    $pfad = Join-Path $ordner (Weitergabe-Dateiname $Bausteine)
    Schreib-Weitergabe $Bausteine $pfad
    return $pfad
}

<#
    Nimmt fremde Bausteine in eine Liste auf. $BeiGleichemNamen entscheidet, was
    bei einem Namen geschieht, den es schon gibt:
      'behalten'    beide bleiben, der neue bekommt den Absender in den Namen
      'ersetzen'    der vorhandene wird überschrieben
      'ueberspringen'  der neue wird nicht übernommen
    Rückgabe: wie viele hinzugekommen, ersetzt und übersprungen wurden.
#>
function Uebernimm-Bausteine {
    param($Ziel, $Neue, [string]$BeiGleichemNamen = 'behalten', [string]$Absender = '')

    $dazu = 0; $ersetzt = 0; $weg = 0
    foreach ($b in @($Neue)) {
        if ($null -eq $b) { continue }
        $vorhanden = @($Ziel) | Where-Object { [string]$_.name -eq [string]$b.name } | Select-Object -First 1

        if ($vorhanden -and $BeiGleichemNamen -eq 'ueberspringen') { $weg++; continue }

        # Immer eine frische Kennung: die des Absenders gilt in dessen Datei.
        $b.id = [guid]::NewGuid().ToString()
        $b.geaendert_von = $env:USERNAME
        $b.geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')

        if ($vorhanden -and $BeiGleichemNamen -eq 'ersetzen') {
            $stelle = $Ziel.IndexOf($vorhanden)
            $Ziel[$stelle] = $b
            $ersetzt++
            continue
        }
        if ($vorhanden) {
            $zusatz = if ($Absender) { " (von $Absender)" } else { ' (übernommen)' }
            $b.name = [string]$b.name + $zusatz
            # Auch der neue Name kann schon belegt sein — dann durchzählen.
            $zaehler = 2
            while (@($Ziel) | Where-Object { [string]$_.name -eq [string]$b.name }) {
                $b.name = [string]$vorhanden.name + $zusatz + " $zaehler"
                $zaehler++
            }
        }
        [void]$Ziel.Add($b)
        $dazu++
    }
    return [pscustomobject]@{ Dazu = $dazu; Ersetzt = $ersetzt; Uebersprungen = $weg }
}

<#
    Schreibt Bausteine in eine andere Textbausteindatei, ohne sie zu öffnen.
    Die gerade geöffnete Datei bleibt unangetastet — nur so lässt sich etwas an
    die Datei der Dienststelle geben, während man in der eigenen arbeitet.
#>
function Kopiere-In-Datei {
    param($Bausteine, [string]$Zieldatei, [string]$BeiGleichemNamen = 'behalten')

    if ($Zieldatei -eq $global:BausteinDatei) {
        return [pscustomobject]@{ Erfolg = $false; Grund = 'Das ist die Datei, die gerade geöffnet ist.' }
    }
    $daten = Lies-Json $Zieldatei
    if ($null -eq $daten) {
        return [pscustomobject]@{ Erfolg = $false; Grund = 'Die Datei ließ sich nicht lesen.' }
    }

    $ziel = New-Object System.Collections.ArrayList
    foreach ($b in @($daten.bausteine)) { if ($b) { [void]$ziel.Add((Vervollstaendige-Baustein $b)) } }

    # Die Bausteine werden vorher verdoppelt: sonst änderte das Übernehmen die
    # Kennung und den Namen der Stücke, die hier noch in Gebrauch sind.
    $kopien = New-Object System.Collections.ArrayList
    foreach ($b in @($Bausteine)) { [void]$kopien.Add((Kopiere-Baustein $b)) }

    $bilanz = Uebernimm-Bausteine $ziel $kopien $BeiGleichemNamen $env:USERNAME

    try {
        if (Test-Path -LiteralPath $Zieldatei) {
            try { Copy-Item -LiteralPath $Zieldatei -Destination "$Zieldatei.sicherung" -Force } catch { }
        }
        $neu = [pscustomobject]@{
            version       = 1
            gespeichert   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            bausteine     = @($ziel)
            vorlagen      = @($daten.vorlagen)
            kombinationen = @($daten.kombinationen)
        }
        Schreib-Json $Zieldatei $neu
    } catch {
        return [pscustomobject]@{ Erfolg = $false; Grund = $_.Exception.Message }
    }
    return [pscustomobject]@{ Erfolg = $true; Bilanz = $bilanz }
}
# =====================================================================
#  3. TEXTMASCHINE
# =====================================================================

# Immer verfügbare Platzhalter — funktionieren in jedem Baustein, ohne dass ein
# Feld dafür angelegt werden muss.
function Eingebaute-Platzhalter {
    $jetzt = Get-Date
    $kultur = New-Object System.Globalization.CultureInfo('de-DE')
    $h = @{}
    $h['heute']        = $jetzt.ToString('dd.MM.yyyy')
    $h['uhrzeit']      = $jetzt.ToString('HH:mm')
    $h['jahr']         = $jetzt.ToString('yyyy')
    $h['monat']        = $jetzt.ToString('MM')
    $h['tag']          = $jetzt.ToString('dd')
    $h['benutzer']     = $env:USERNAME
    $h['computer']     = $env:COMPUTERNAME
    return $h
}

function Hole-Zwischenablage {
    try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { return [System.Windows.Forms.Clipboard]::GetText() } } catch { }
    return ''
}

# Liefert alle Platzhalternamen, die im Text vorkommen (für Prüfungen im Verwaltungsfenster).
function Finde-Platzhalter {
    param([string]$Text)
    $namen = New-Object System.Collections.ArrayList
    foreach ($m in ([regex]'\{([^{}\r\n]{1,80})\}').Matches([string]$Text)) {
        $n = $m.Groups[1].Value.Trim()
        if (-not $namen.Contains($n)) { [void]$namen.Add($n) }
    }
    return , $namen
}

# =====================================================================
#  4. FORMATIERTER TEXT
# =====================================================================

<#
    Bausteine werden als Rich Text gespeichert. Damit lassen sich Schriftart,
    Größe, Fett, Kursiv, Unterstrichen und der Zeilenabstand schon in der Vorlage
    festlegen — und genau das kommt beim Einfügen heraus.

    Gerechnet wird nie an der RTF-Zeichenkette selbst, sondern immer in einem
    unsichtbaren Rich-Text-Feld. Das erspart das Zerlegen von RTF-Befehlen und hat
    einen angenehmen Nebeneffekt: Ein eingesetzter Wert übernimmt automatisch die
    Formatierung der Stelle, an der sein Platzhalter stand. Ein fett gesetztes
    {Nachname} kommt also fett heraus.
#>

function Neues-Rechenfeld {
    $r = New-Object System.Windows.Forms.RichTextBox
    $r.WordWrap = $false
    [void]$r.Handle      # erzwingt das Fenster; ohne Fenster greifen die Windows-Nachrichten nicht
    return $r
}

function Setze-Absatzformat {
    param($Feld, [double]$Zeilenabstand = 1.5, [int]$AbstandNachAbsatz = 0)
    [DocKit.Absatz]::ZeilenabstandSetzen($Feld.Handle, $Zeilenabstand, $AbstandNachAbsatz)
}

function Standard-Schrift {
    $name = 'Arial'
    $groesse = 12.0
    if ($global:Einstellungen) {
        if ($global:Einstellungen.standard_schriftart) { $name = [string]$global:Einstellungen.standard_schriftart }
        if ($global:Einstellungen.standard_groesse)    { $groesse = [double]$global:Einstellungen.standard_groesse }
    }
    try { return (New-Object System.Drawing.Font($name, $groesse)) }
    catch { return (New-Object System.Drawing.Font('Arial', 12)) }
}

function Standard-Zeilenabstand {
    if ($global:Einstellungen -and $global:Einstellungen.standard_zeilenabstand) {
        return [double]$global:Einstellungen.standard_zeilenabstand
    }
    return 1.5
}

# Aus reinem Text wird formatierter Text in der eingestellten Standardschrift.
function Text-Nach-Rtf {
    param([string]$Text)
    $r = Neues-Rechenfeld
    $r.Font = Standard-Schrift
    $r.Text = [string]$Text
    $r.SelectAll()
    $r.SelectionFont = $r.Font
    Setze-Absatzformat $r (Standard-Zeilenabstand)
    $r.Select(0, 0)
    $rtf = $r.Rtf
    $r.Dispose()
    return $rtf
}

# Die maßgebliche Fassung eines Bausteins. Alte Bausteine ohne RTF werden umgesetzt.
function Hole-Baustein-Rtf {
    param($Baustein)
    if ($Baustein.PSObject.Properties['rtf'] -and -not [string]::IsNullOrWhiteSpace($Baustein.rtf)) {
        return [string]$Baustein.rtf
    }
    return (Text-Nach-Rtf ([string]$Baustein.text))
}

# Räumt auf, was durch weggefallene Felder entstanden ist.
function Raeume-Rechenfeld-Auf {
    param($Feld)
    $schutz = 0
    while ($schutz -lt 200) {
        $m = [regex]::Match($Feld.Text, '[ \t]+(\r?\n)')
        if (-not $m.Success) { break }
        $Feld.Select($m.Index, $m.Length); $Feld.SelectedText = "`n"; $schutz++
    }
    $schutz = 0
    while ($schutz -lt 200) {
        $m = [regex]::Match($Feld.Text, '(\r?\n){3,}')
        if (-not $m.Success) { break }
        $Feld.Select($m.Index, $m.Length); $Feld.SelectedText = "`n`n"; $schutz++
    }
    $schutz = 0
    while ($schutz -lt 200) {
        $m = [regex]::Match($Feld.Text, '[ ]+([,.;:!?])')
        if (-not $m.Success) { break }
        $Feld.Select($m.Index, $m.Length); $Feld.SelectedText = $m.Groups[1].Value; $schutz++
    }
    $t = $Feld.Text
    $vorn = $t.Length - $t.TrimStart().Length
    if ($vorn -gt 0) { $Feld.Select(0, $vorn); $Feld.SelectedText = '' }
    $t = $Feld.Text
    $hinten = $t.Length - $t.TrimEnd().Length
    if ($hinten -gt 0) { $Feld.Select($t.Length - $hinten, $hinten); $Feld.SelectedText = '' }
    $Feld.Select(0, 0)
}

<#
    Ersetzt die Platzhalter im formatierten Text. Gearbeitet wird auf der
    Textebene des Rich-Text-Feldes; die Formatierung bleibt dabei erhalten.
    Rückgabe: die formatierte und die reine Fassung des Ergebnisses.
#>
function Ersetze-Platzhalter-Rtf {
    param([string]$Rtf, [hashtable]$Werte)

    $r = Neues-Rechenfeld
    try { $r.Rtf = $Rtf } catch { $r.Text = '' }

    $alle = Eingebaute-Platzhalter
    if ($Werte) { foreach ($k in $Werte.Keys) { $alle[[string]$k] = [string]$Werte[$k] } }
    if ($r.Text -match '\{\s*zwischenablage\s*\}') { $alle['zwischenablage'] = Hole-Zwischenablage }

    $muster = [regex]'\{([^{}\r\n]{1,80})\}'

    # Mehrere Durchgänge: der Text eines Ja/Nein-Schalters darf selbst wieder
    # Platzhalter enthalten, etwa "Rückmeldung bis zum {Fristdatum}".
    for ($durchgang = 0; $durchgang -lt 5; $durchgang++) {
        $etwasErsetzt = $false
        $ab = 0
        while ($ab -le $r.TextLength) {
            $treffer = $muster.Match($r.Text, $ab)
            if (-not $treffer.Success) { break }
            $name = $treffer.Groups[1].Value.Trim()
            if ($alle.ContainsKey($name)) {
                $wert = [string]$alle[$name]
                $r.Select($treffer.Index, $treffer.Length)
                $r.SelectedText = $wert
                $ab = $treffer.Index + $wert.Length
                $etwasErsetzt = $true
            } else {
                $ab = $treffer.Index + $treffer.Length
            }
        }
        if (-not $etwasErsetzt) { break }
    }

    <#
        Enthält der Baustein eine Tabelle, wird nicht aufgeräumt. Zeilenumbrüche
        und Tabulatoren sind dort Teil des Gerüsts — sie zu kürzen oder die Ränder
        zu beschneiden reißt die Tabelle auseinander. Nachgewiesen: Ohne diese
        Ausnahme kam im Zieldokument gar keine Tabelle mehr an.
    #>
    $hatTabelle = ($Rtf -match '\\trowd')
    if ($global:Einstellungen -and $global:Einstellungen.leere_zeilen_aufraeumen -and -not $hatTabelle) {
        Raeume-Rechenfeld-Auf $r
    }

    $ergebnis = [pscustomobject]@{ Rtf = $r.Rtf; Text = $r.Text }
    $r.Dispose()
    return $ergebnis
}

<#
    Legt beide Fassungen gleichzeitig in die Zwischenablage: formatiert und
    schlicht. Word und Outlook greifen sich die formatierte, ein einfaches
    Eingabefeld die reine — jedes Programm bekommt, was es versteht.
#>
function Setze-Zwischenablage {
    param([string]$Text, [string]$Rtf = '')
    $nurText = ($global:Einstellungen -and $global:Einstellungen.nur_reiner_text)
    for ($i = 0; $i -lt 5; $i++) {
        try {
            if ([string]::IsNullOrEmpty($Text) -and [string]::IsNullOrEmpty($Rtf)) {
                [System.Windows.Forms.Clipboard]::Clear()
            } else {
                $daten = New-Object System.Windows.Forms.DataObject
                $daten.SetData([System.Windows.Forms.DataFormats]::UnicodeText, [string]$Text)
                if ($Rtf -and -not $nurText) {
                    $daten.SetData([System.Windows.Forms.DataFormats]::Rtf, [string]$Rtf)
                }
                [System.Windows.Forms.Clipboard]::SetDataObject($daten, $true)
            }
            return $true
        } catch { Start-Sleep -Milliseconds 60 }
    }
    return $false
}

<#
    Legt den Text in die Zwischenablage und fügt ihn — sofern gewünscht — direkt in
    das Fenster ein, das vor dem Aufruf aktiv war. Genau das ist der Unterschied zu
    einem gewöhnlichen "Kopieren"-Knopf: der Text landet dort, wo der Cursor steht.
#>
function Fuege-Text-Ein {
    param([string]$Text, [string]$Rtf = '', [IntPtr]$Zielfenster, [switch]$NurKopieren)

    $vorher = $null
    if ($global:Einstellungen.zwischenablage_zuruecksetzen) { $vorher = Hole-Zwischenablage }

    if (-not (Setze-Zwischenablage -Text $Text -Rtf $Rtf)) {
        [System.Windows.Forms.MessageBox]::Show(
            'Die Zwischenablage ist gerade von einem anderen Programm belegt. Bitte noch einmal versuchen.',
            'DocKit', 'OK', 'Warning') | Out-Null
        return
    }

    $sollEinfuegen = (-not $NurKopieren) -and $global:Einstellungen.automatisch_einfuegen
    if ($sollEinfuegen -and $Zielfenster -ne [IntPtr]::Zero) {
        [DocKit.Windows]::FokusZurueck($Zielfenster)
        Start-Sleep -Milliseconds 140
        try { [System.Windows.Forms.SendKeys]::SendWait('^v') } catch { }
        if ($null -ne $vorher) {
            Start-Sleep -Milliseconds 400
            [void](Setze-Zwischenablage $vorher)
        }
    }
}

<#
    Einen Baustein tatsächlich benutzen: Hat er Felder, geht der Assistent auf;
    sonst landet er ohne Umweg in der Zwischenablage und im Zielfenster.

    Eigene Funktion, weil das von zwei Stellen gebraucht wird, die sich sonst
    kaum ähneln — der Auswahl in der Schnellwahl und der Kürzel-Erkennung beim
    Tippen (Abschnitt 3a). Beide kennen nur "diesen Baustein, in dieses Fenster",
    den Rest erledigt diese Funktion.

    Rückgabe: 'einfuegen', 'kopieren' oder 'abbruch' — der Aufrufer entscheidet,
    was ein Abbruch für ihn bedeutet.
#>
function Benutze-Baustein {
    param($Baustein, [IntPtr]$Zielfenster)

    if (@($Baustein.felder).Count -eq 0) {
        $erg = Ersetze-Platzhalter-Rtf -Rtf (Hole-Baustein-Rtf $Baustein) -Werte @{}
        Fuege-Text-Ein -Text $erg.Text -Rtf $erg.Rtf -Zielfenster $Zielfenster
        return 'einfuegen'
    }

    $ergebnis = Zeige-Assistent -Baustein $Baustein
    if ($ergebnis.Aktion -eq 'einfuegen') {
        Fuege-Text-Ein -Text $ergebnis.Text -Rtf $ergebnis.Rtf -Zielfenster $Zielfenster
    } elseif ($ergebnis.Aktion -eq 'kopieren') {
        Fuege-Text-Ein -Text $ergebnis.Text -Rtf $ergebnis.Rtf -Zielfenster $Zielfenster -NurKopieren
        Zeige-Meldung 'Der Text liegt jetzt in der Zwischenablage. Mit Strg+V einfügen.' 'Kopiert'
    }
    return $ergebnis.Aktion
}

<#
    Kürzel-Erkennung: Tippt der Anwender in irgendeinem Programm ein Kürzel wie
    "#AV" (bei einem Baustein hinterlegt) gefolgt von Leertaste, Enter oder Tab,
    landet der Baustein dort — ganz ohne Strg+Alt+T. Bewusst abschaltbar und
    standardmäßig aus, weil das technisch einen systemweiten Tastatur-Haken
    braucht (DocKit.Kuerzelwaechter); Einzelheiten in PRUEFUNG.md.

    Der Haken selbst darf nie lange beschäftigt sein — deshalb sammelt er nur,
    welche Kürzel getippt wurden, und ein Zeitgeber holt sie regelmäßig ab. Das
    eigentliche Einsetzen (unter Umständen mit Assistent, der offen bleibt, bis
    der Anwender fertig ist) passiert erst hier, außerhalb des Hakens.
#>

# Meldet dem Haken, auf welche Kürzel er gerade achten soll — nach jedem Laden,
# Speichern oder Bearbeiten der Bausteine neu aufgerufen.
function Aktualisiere-Autotext-Kuerzel {
    if ($null -eq $global:Kuerzelwaechter) { return }
    $liste = @($global:Bausteine) |
        Where-Object { $_ -and -not [string]::IsNullOrWhiteSpace([string]$_.autotext_kuerzel) } |
        ForEach-Object { [string]$_.autotext_kuerzel }
    $global:Kuerzelwaechter.KuerzelSetzen([string[]]$liste)
}

# Ein erkanntes Kürzel tatsächlich verarbeiten: das Kürzel selbst wegtippen
# (die Wortgrenze danach hat der Haken schon verschluckt) und den Baustein an
# seine Stelle setzen.
function Verarbeite-Autotext-Treffer {
    param([string]$Kuerzel)
    $baustein = @($global:Bausteine) |
        Where-Object { $_ -and [string]$_.autotext_kuerzel -eq $Kuerzel } |
        Select-Object -First 1
    if ($null -eq $baustein) { return }   # zwischenzeitlich geändert oder gelöscht

    $ziel = [DocKit.Windows]::GetForegroundWindow()
    [DocKit.Windows]::FokusZurueck($ziel)
    try {
        for ($i = 0; $i -lt $Kuerzel.Length; $i++) { [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}') }
    } catch { }
    [void](Benutze-Baustein -Baustein $baustein -Zielfenster $ziel)
}

function Starte-Autotext {
    if ($null -eq $global:Kuerzelwaechter) { $global:Kuerzelwaechter = New-Object DocKit.Kuerzelwaechter }
    Aktualisiere-Autotext-Kuerzel
    $erfolg = $global:Kuerzelwaechter.Installieren()
    if (-not $erfolg) {
        $code = $global:Kuerzelwaechter.LetzterFehler
        Zeige-Meldung ("Die Kürzel-Erkennung ließ sich nicht anmelden (Systemfehler $code). " +
            "Möglich, dass ein Sicherheitsprogramm das verhindert hat — die Einstellung bleibt " +
            "angehakt, wirkt aber nicht.") 'Kürzel-Erkennung' 'Warning'
        return
    }

    if ($null -eq $global:AutotextZeitgeber) {
        $global:AutotextZeitgeber = New-Object System.Windows.Forms.Timer
        $global:AutotextZeitgeber.Interval = 60
        $global:AutotextZeitgeber.Add_Tick({
            if ($null -eq $global:Kuerzelwaechter) { return }
            $wort = $global:Kuerzelwaechter.NaechsterTreffer()
            while ($null -ne $wort) {
                Verarbeite-Autotext-Treffer $wort
                $wort = $global:Kuerzelwaechter.NaechsterTreffer()
            }
        })
    }
    $global:AutotextZeitgeber.Start()
}

function Stoppe-Autotext {
    if ($global:AutotextZeitgeber) { $global:AutotextZeitgeber.Stop() }
    if ($global:Kuerzelwaechter) { $global:Kuerzelwaechter.Entfernen() }
}


# =====================================================================
#  5. OBERFLÄCHE — gemeinsame Bausteine für alle Fenster
# =====================================================================

if (-not ('DocKit.Option' -as [type])) {
    Add-Type -TypeDefinition @'
namespace DocKit {
    // Ein Eintrag einer Auswahlliste: was der Anwender sieht, und was eingefügt wird.
    public class Option {
        public string Anzeige;
        public string Wert;
        public Option(string anzeige, string wert) { Anzeige = anzeige; Wert = wert; }
        public override string ToString() { return Anzeige; }
    }
}
'@
}

$global:Farbe = @{
    Hintergrund = [System.Drawing.Color]::FromArgb(247, 248, 250)
    Flaeche     = [System.Drawing.Color]::White
    Rahmen      = [System.Drawing.Color]::FromArgb(214, 218, 224)
    Akzent      = [System.Drawing.Color]::FromArgb(0, 84, 140)
    AkzentHell  = [System.Drawing.Color]::FromArgb(232, 240, 248)
    Text        = [System.Drawing.Color]::FromArgb(28, 30, 34)
    Grau        = [System.Drawing.Color]::FromArgb(105, 112, 122)
    Warnung     = [System.Drawing.Color]::FromArgb(190, 40, 40)
    Vorlage     = [System.Drawing.Color]::FromArgb(21, 110, 71)   # Vorlagen sind Dateien, keine Texte
    Kombination = [System.Drawing.Color]::FromArgb(111, 66, 152)   # Vorlage + Baustein zusammen
}

$global:Schrift      = New-Object System.Drawing.Font('Segoe UI', 10)
$global:SchriftFett  = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$global:SchriftKlein = New-Object System.Drawing.Font('Segoe UI', 8.5)
$global:SchriftTitel = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$global:SchriftSuche = New-Object System.Drawing.Font('Segoe UI', 13)
$global:SchriftFest  = New-Object System.Drawing.Font('Consolas', 10.5)

# Das Symbol wird zur Laufzeit gezeichnet — so kommt das Programm ohne Bilddatei aus.
function Erzeuge-Symbol {
    $kante = 32
    $bild = New-Object System.Drawing.Bitmap $kante, $kante
    $g = [System.Drawing.Graphics]::FromImage($bild)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    # Ein schmaler Rand, sonst klebt der Kreis am Bildrand und wirkt beschnitten
    $rand = [int]($kante / 16)
    $pinsel = New-Object System.Drawing.SolidBrush $global:Farbe.Akzent
    $g.FillEllipse($pinsel, $rand, $rand, ($kante - 2 * $rand - 1), ($kante - 2 * $rand - 1))
    # Größe in Bildpunkten statt Punkt: sonst hängt das Symbol an der Bildschirmauflösung
    $schrift = New-Object System.Drawing.Font('Segoe UI', ($kante * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = 'Center'
    $format.LineAlignment = 'Center'
    $g.DrawString('DK', $schrift, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, $kante, $kante), $format)
    $schrift.Dispose(); $pinsel.Dispose(); $g.Dispose()
    $zeiger = $bild.GetHicon()
    return [System.Drawing.Icon]::FromHandle($zeiger)
}

<#
    Baut ein leeres Fenster mit den Farben und der Schrift der Anwendung.

    -MitKennung setzt oben eine schmale Zeile mit Symbol und Urheber hinein.
    Sie steht nur in den Einstellungen — dort sucht man so etwas. In den
    Arbeitsfenstern wäre sie bei jedem Öffnen im Weg.
#>
function Neues-Fenster {
    param([string]$Titel, [int]$Breite = 900, [int]$Hoehe = 640, [string]$Rahmen = 'Sizable', [switch]$MitKennung)

    # Nie größer als der Bildschirm: auf einem Dienstlaptop mit 1366x768 wäre
    # sonst die untere Knopfleiste nicht mehr erreichbar.
    if ($MitKennung) { $Hoehe = $Hoehe + 16 }      # Platz für die Kennzeile
    $platz = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $Breite = [Math]::Min($Breite, $platz.Width - 60)
    $Hoehe  = [Math]::Min($Hoehe, $platz.Height - 60)

    $f = New-Object System.Windows.Forms.Form
    $f.Text            = $Titel
    $f.ClientSize      = New-Object System.Drawing.Size($Breite, $Hoehe)
    $f.StartPosition   = 'CenterScreen'
    $f.Font            = $global:Schrift
    $f.BackColor       = $global:Farbe.Hintergrund
    $f.ForeColor       = $global:Farbe.Text
    $f.FormBorderStyle = $Rahmen
    $f.KeyPreview      = $true
    if ($global:Symbol) { $f.Icon = $global:Symbol }

    if ($MitKennung) {
        $kennzeile = New-Object System.Windows.Forms.Panel
        $kennzeile.Dock = 'Top'
        $kennzeile.Height = 16
        $kennzeile.BackColor = $global:Farbe.Flaeche

        if ($global:Symbol) {
            $zeichen = New-Object System.Windows.Forms.PictureBox
            $zeichen.Image = $global:Symbol.ToBitmap()
            $zeichen.SizeMode = 'Zoom'
            $zeichen.Size = New-Object System.Drawing.Size(11, 11)
            $zeichen.Location = New-Object System.Drawing.Point(6, 2)
            $kennzeile.Controls.Add($zeichen)
        }
        $kennung = New-Object System.Windows.Forms.Label
        $kennung.Text = 'DocKit  ·  by Tim Oldenburg'
        $kennung.AutoSize = $true
        $kennung.Font = New-Object System.Drawing.Font('Segoe UI', 6.75)
        $kennung.ForeColor = $global:Farbe.Grau
        $kennung.Location = New-Object System.Drawing.Point(21, 3)
        $kennzeile.Controls.Add($kennung)

        $kennTrenner = New-Object System.Windows.Forms.Panel
        $kennTrenner.Dock = 'Bottom'
        $kennTrenner.Height = 1
        $kennTrenner.BackColor = $global:Farbe.Rahmen
        $kennzeile.Controls.Add($kennTrenner)

        $f.Controls.Add($kennzeile)

        <#
            WinForms dockt in umgekehrter Z-Reihenfolge: Wer hinten steht, bekommt
            den äußeren Rand. Die Kennzeile wird deshalb beim Anzeigen ganz nach
            hinten geschickt — sonst legt sie sich unter die Leisten, die das
            aufrufende Fenster erst später hinzufügt.
        #>
        $f.Add_Shown({ $kennzeile.SendToBack() }.GetNewClosure())
    }

    return $f
}

function Neuer-Knopf {
    param([string]$Text, [int]$Breite = 140, [int]$Hoehe = 34, [switch]$Betont)
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $Text
    $b.Size = New-Object System.Drawing.Size($Breite, $Hoehe)
    $b.FlatStyle = 'Flat'
    $b.FlatAppearance.BorderColor = $global:Farbe.Rahmen
    $b.FlatAppearance.BorderSize = 1
    $b.BackColor = $global:Farbe.Flaeche
    $b.Cursor = 'Hand'
    if ($Betont) {
        $b.BackColor = $global:Farbe.Akzent
        $b.ForeColor = [System.Drawing.Color]::White
        $b.Font = $global:SchriftFett
        $b.FlatAppearance.BorderColor = $global:Farbe.Akzent
    }
    return $b
}

function Neue-Beschriftung {
    param([string]$Text, [switch]$Fett, [switch]$Klein, [switch]$Grau)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $Text
    $l.AutoSize = $true
    $l.Font = if ($Fett) { $global:SchriftFett } elseif ($Klein) { $global:SchriftKlein } else { $global:Schrift }
    if ($Grau -or $Klein) { $l.ForeColor = $global:Farbe.Grau }
    return $l
}

function Neues-Eingabefeld {
    param([int]$Breite = 300, [switch]$Mehrzeilig, [int]$Hoehe = 26)
    $t = New-Object System.Windows.Forms.TextBox
    $t.Width = $Breite
    $t.BorderStyle = 'FixedSingle'
    $t.BackColor = $global:Farbe.Flaeche
    if ($Mehrzeilig) {
        $t.Multiline = $true
        $t.ScrollBars = 'Vertical'
        $t.Height = $Hoehe
    }
    return $t
}

<#
    Setzt Steuerelemente untereinander und misst dabei die tatsächliche Höhe jeder
    Beschriftung. Feste Pixelabstände würden sich verschieben, sobald Windows mit
    größerer Schrift oder auf einem hochauflösenden Bildschirm läuft — dann läge
    die Beschriftung auf dem Eingabefeld.
#>
function Setze-Unter {
    param($Behaelter, $Element, [ref]$Y, [int]$Links = 16, [int]$Abstand = 6)
    $Element.Location = New-Object System.Drawing.Point($Links, $Y.Value)
    [void]$Behaelter.Controls.Add($Element)
    $hoehe = $Element.Height
    if ($Element -is [System.Windows.Forms.Label] -and $Element.AutoSize) { $hoehe = $Element.PreferredHeight }
    $Y.Value = $Y.Value + $hoehe + $Abstand
}

<#
    Setzt Steuerelemente nebeneinander in eine Reihe und richtet sie mittig zueinander
    aus — Klapplisten sind niedriger als Knöpfe, sonst stünde alles auf verschiedenen
    Höhen. Ganze Zahlen in der Liste wirken als Abstandhalter.
    Rückgabe: die Höhe der Reihe.
#>
function Setze-Reihe {
    param($Behaelter, $Elemente, [int]$Oben = 0, [int]$Links = 0)
    $hoehe = 0
    foreach ($e in $Elemente) { if ($e -isnot [int] -and $e.Height -gt $hoehe) { $hoehe = $e.Height } }
    $x = $Links
    foreach ($e in $Elemente) {
        if ($e -is [int]) { $x += $e; continue }
        $e.Location = New-Object System.Drawing.Point($x, ($Oben + [int](($hoehe - $e.Height) / 2)))
        [void]$Behaelter.Controls.Add($e)
        $x += $e.Width
    }
    return $hoehe
}

<#
    Ein Puzzleteil, wie man es kennt: quadratischer Körper, zwei Nasen und zwei
    Mulden. Zwei Kniffe stecken darin.

    Erstens sitzt der Mittelpunkt jedes Kreises nicht auf der Kante, sondern ein
    Stück daneben. Dadurch ist die Öffnung zum Körper schmaler als der Kreis —
    der Hals, an dem man ein Puzzleteil erkennt. Läge der Mittelpunkt auf der
    Kante, wären es bloß Halbkreise und das Ganze sähe aus wie ein Klecks.

<#
    Ein Buchstabe auf einer sehr hellen Fläche derselben Farbe. Zurückhaltend
    gehalten: Die Liste besteht aus Text, ein kräftig gefülltes Feld je Zeile
    würde davon ablenken. Die Fläche bleibt trotzdem — ein frei stehender
    Buchstabe wirkt in einer Zeile verloren und gibt dem Auge keinen Halt.
#>
function Zeichne-Buchstabensymbol {
    param([string]$Buchstabe, $Farbe, [int]$Kante = 20)

    $bild = New-Object System.Drawing.Bitmap $Kante, $Kante
    $g = [System.Drawing.Graphics]::FromImage($bild)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Abgerundetes Feld aus vier Vierteln, mit zwei Pixeln Luft ringsum
    $a = 2.0
    $b = $Kante - 2.0
    $ecke = 3.5
    $feld = New-Object System.Drawing.Drawing2D.GraphicsPath
    $feld.AddArc($a, $a, (2*$ecke), (2*$ecke), 180, 90)
    $feld.AddArc(($b - 2*$ecke), $a, (2*$ecke), (2*$ecke), 270, 90)
    $feld.AddArc(($b - 2*$ecke), ($b - 2*$ecke), (2*$ecke), (2*$ecke), 0, 90)
    $feld.AddArc($a, ($b - 2*$ecke), (2*$ecke), (2*$ecke), 90, 90)
    $feld.CloseFigure()

    # Dieselbe Farbe, nur zu 15 Prozent deckend
    $hell = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, $Farbe.R, $Farbe.G, $Farbe.B))
    $g.FillPath($hell, $feld)

    # Größe in Bildpunkten, damit sie nicht an der Bildschirmauflösung hängt
    $schrift = New-Object System.Drawing.Font('Segoe UI', ($Kante * 0.6), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $mitte = New-Object System.Drawing.StringFormat
    $mitte.Alignment = 'Center'; $mitte.LineAlignment = 'Center'
    $dunkel = New-Object System.Drawing.SolidBrush $Farbe
    $g.DrawString($Buchstabe, $schrift, $dunkel, (New-Object System.Drawing.RectangleF $a, $a, ($b - $a), ($b - $a)), $mitte)

    $schrift.Dispose(); $hell.Dispose(); $dunkel.Dispose(); $feld.Dispose(); $g.Dispose()
    return $bild
}

<#
    Zwei kleine Symbole für die Ergebnisliste, zur Laufzeit gezeichnet: ein
    blaues „T" für Textbausteine, ein grünes „V" für Vorlagen. Ohne sie sehen
    beide Arten gleich aus — bei einer großen Datei übersieht man die Vorlagen.
#>
function Erzeuge-Listensymbole {
    $bilder = New-Object System.Windows.Forms.ImageList
    $bilder.ImageSize = New-Object System.Drawing.Size(20, 20)
    $bilder.ColorDepth = 'Depth32Bit'

    $bilder.Images.Add((Zeichne-Buchstabensymbol 'T' $global:Farbe.Akzent))    # 0 — Textbaustein
    $bilder.Images.Add((Zeichne-Buchstabensymbol 'V' $global:Farbe.Vorlage))   # 1 — Vorlage
    $bilder.Images.Add((Zeichne-Buchstabensymbol 'K' $global:Farbe.Kombination)) # 2 — Kombination

    return $bilder
}

# Schmaler senkrechter Strich zwischen zwei Gruppen einer Werkzeugleiste.
function Neuer-Gruppentrenner {
    param([int]$Hoehe = 22)
    $l = New-Object System.Windows.Forms.Label
    $l.Size = New-Object System.Drawing.Size(1, $Hoehe)
    $l.BackColor = $global:Farbe.Rahmen
    return $l
}

<#
    Fügt eine Platzhaltermarke an der Cursorstelle ein. Bewusst ohne Closure:
    Das Menü trägt sein Zielfeld im Tag, der Eintrag seinen Namen — der Handler
    holt sich beides vom Absender. Ein GetNewClosure innerhalb eines Closures
    würde die Variablen nicht erben (siehe README).
#>
$global:MarkeEinfuegen = {
    param($absender, $e2)
    $ziel = $absender.Owner.Tag
    if ($null -eq $ziel) { return }
    $marke = "{$($absender.Tag)}"
    $pos = $ziel.SelectionStart
    $ziel.SelectedText = $marke
    $ziel.SelectionStart = $pos + $marke.Length
    $ziel.SelectionLength = 0
    [void]$ziel.Focus()
}

# Klappt unter dem Knopf die Liste der verfügbaren Platzhalter auf.
function Zeige-Platzhaltermenue {
    param($Knopf, $Zielfeld, $Feldnamen = @())
    $menue = New-Object System.Windows.Forms.ContextMenuStrip
    $menue.Tag = $Zielfeld
    $global:PlatzhalterMenue = $menue      # Verweis halten, sonst räumt der Speicherbereiniger auf

    $eigene = @($Feldnamen | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    foreach ($n in $eigene) {
        $eintrag = $menue.Items.Add("{$n}")
        $eintrag.Tag = [string]$n
        $eintrag.Add_Click($global:MarkeEinfuegen)
    }
    if ($eigene.Count -gt 0) { [void]$menue.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) }
    foreach ($n in @('heute', 'uhrzeit', 'jahr', 'monat', 'tag', 'benutzer', 'zwischenablage')) {
        $eintrag = $menue.Items.Add("{$n}")
        $eintrag.Tag = $n
        $eintrag.Add_Click($global:MarkeEinfuegen)
    }
    $menue.Show($Knopf, 0, $Knopf.Height)
}

<#
    Eine Zeile abfragen — etwa einen neuen Kategorienamen.
    Rückgabe: der eingegebene Text, oder '' bei Abbruch.
#>
function Frage-Nach-Text {
    param([string]$Titel, [string]$Beschriftung, [string]$Vorgabe = '')

    $fenster = Neues-Fenster -Titel $Titel -Breite 480 -Hoehe 150 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false
    $fenster.TopMost = $true

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $l = Neue-Beschriftung -Text $Beschriftung -Fett
    $e = Neues-Eingabefeld -Breite 420
    $e.Anchor = 'Top,Left,Right'
    $e.Text = $Vorgabe
    $y = 16
    Setze-Unter $flaeche $l ([ref]$y) 20 4
    Setze-Unter $flaeche $e ([ref]$y) 20 10

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 52; $fuss.BackColor = $global:Farbe.Hintergrund
    $ok  = Neuer-Knopf -Text 'Übernehmen' -Breite 130 -Betont
    $aus = Neuer-Knopf -Text 'Abbrechen' -Breite 110
    $ok.Anchor = 'Top,Right'; $aus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($ok, $aus))
    $fenster.Controls.Add($fuss)

    $global:TextfrageErgebnis = ''
    $ok.Add_Click({ $global:TextfrageErgebnis = $e.Text.Trim(); $fenster.Close() }.GetNewClosure())
    $aus.Add_Click({ $global:TextfrageErgebnis = ''; $fenster.Close() }.GetNewClosure())
    $fenster.AcceptButton = $ok
    $fenster.CancelButton = $aus

    $ordne = {
        $ok.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $ok.Width), 10)
        $aus.Location = New-Object System.Drawing.Point(($ok.Left - 10 - $aus.Width), 10)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({ & $ordne; [void]$e.Focus(); $e.SelectAll() }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:TextfrageErgebnis
}

function Zeige-Meldung {
    param([string]$Text, [string]$Titel = 'DocKit', [string]$Symbol = 'Information')
    [void][System.Windows.Forms.MessageBox]::Show($Text, $Titel, 'OK', $Symbol)
}

function Frage-Ja-Nein {
    param([string]$Text, [string]$Titel = 'DocKit')
    return ([System.Windows.Forms.MessageBox]::Show($Text, $Titel, 'YesNo', 'Question') -eq 'Yes')
}

# --- Hilfsfunktionen rund um Felder ---------------------------------------------

$global:Feldtypen = [ordered]@{
    'text'       = 'Textfeld (eine Zeile)'
    'mehrzeilig' = 'Textfeld (mehrere Zeilen)'
    'auswahl'    = 'Auswahlliste (z. B. Herr/Frau)'
    'datum'      = 'Datum'
    'uhrzeit'    = 'Uhrzeit'
    'zahl'       = 'Zahl'
    'schalter'   = 'Ja/Nein — Textblock ein- oder ausblenden'
}

function Werte-Datum {
    param([string]$Standard)
    $heute = Get-Date
    if ([string]::IsNullOrWhiteSpace($Standard)) { return $heute }
    $s = $Standard.Trim().ToLower()
    if ($s -eq 'heute')   { return $heute }
    if ($s -eq 'morgen')  { return $heute.AddDays(1) }
    if ($s -eq 'gestern') { return $heute.AddDays(-1) }
    if ($s -match '^([+-])\s*(\d+)$') { return $heute.AddDays([int]("$($Matches[1])$($Matches[2])")) }
    $d = [datetime]::MinValue
    $de = [System.Globalization.CultureInfo]::GetCultureInfo('de-DE')
    if ([datetime]::TryParse($Standard, $de, [System.Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
    return $heute
}

function Lies-Optionen {
    param($Feld)
    $liste = New-Object System.Collections.ArrayList
    foreach ($o in @($Feld.optionen)) {
        if ($null -eq $o) { continue }
        if ($o -is [string]) {
            [void]$liste.Add((New-Object DocKit.Option($o, $o)))
        } else {
            $anzeige = ''
            $wert    = ''
            if ($o.PSObject.Properties['anzeige']) { $anzeige = [string]$o.anzeige }
            if ($o.PSObject.Properties['wert'])    { $wert    = [string]$o.wert }
            if ([string]::IsNullOrEmpty($anzeige)) { $anzeige = $wert }
            if ([string]::IsNullOrEmpty($wert) -and -not $o.PSObject.Properties['wert']) { $wert = $anzeige }
            [void]$liste.Add((New-Object DocKit.Option($anzeige, $wert)))
        }
    }
    return , $liste
}

# Färbt übrig gebliebene {Platzhalter} rot ein, damit sofort auffällt, wo noch etwas fehlt.
function Faerbe-Platzhalter {
    param($Anzeige)
    # Nur die übrig gebliebenen Marken einfärben. Die Formatierung des Bausteins
    # darf dabei nicht angetastet werden — deshalb kein SelectAll mit Rücksetzen.
    $text = $Anzeige.Text
    foreach ($m in ([regex]'\{[^{}\r\n]{1,80}\}').Matches($text)) {
        $Anzeige.Select($m.Index, $m.Length)
        $Anzeige.SelectionColor = $global:Farbe.Warnung
    }
    $Anzeige.Select(0, 0)
}

# =====================================================================
#  6. ASSISTENT — "Baustein zusammenstellen"
# =====================================================================

<#
    Öffnet das Fenster, in dem der Anwender die beweglichen Teile eines Bausteins
    zusammensucht: Anrede wählen, Datum setzen, Namen eintragen, optionale Absätze
    an- oder abschalten. Rechts läuft die Vorschau mit.

    Rückgabe: der fertige Text, oder $null bei Abbruch.
    Der Schalter -NurVorschau blendet den Einfügen-Knopf aus (für den Test aus der
    Verwaltung heraus).
#>
function Zeige-Assistent {
    param($Baustein, [switch]$NurVorschau)

    $felder = @($Baustein.felder)

    $fenster = Neues-Fenster -Titel "Baustein zusammenstellen — $($Baustein.name)" -Breite 980 -Hoehe 620
    $fenster.MinimumSize = New-Object System.Drawing.Size(760, 480)

    # --- Kopfzeile ---
    $kopf = New-Object System.Windows.Forms.Panel
    $kopf.Dock = 'Top'
    $kopf.Height = 62
    $kopf.BackColor = $global:Farbe.Flaeche
    $kopf.Padding = New-Object System.Windows.Forms.Padding(16, 10, 16, 10)

    $titel = Neue-Beschriftung -Text $Baustein.name -Fett
    $titel.Font = $global:SchriftTitel
    $titel.Location = New-Object System.Drawing.Point(16, 10)
    $kopf.Controls.Add($titel)

    $untertitel = Neue-Beschriftung -Text $(if ($Baustein.beschreibung) { $Baustein.beschreibung } else { "Kategorie: $($Baustein.kategorie)" }) -Klein
    $untertitel.Location = New-Object System.Drawing.Point(18, 38)
    $kopf.Controls.Add($untertitel)

    $trennerOben = New-Object System.Windows.Forms.Panel
    $trennerOben.Dock = 'Bottom'
    $trennerOben.Height = 1
    $trennerOben.BackColor = $global:Farbe.Rahmen
    $kopf.Controls.Add($trennerOben)

    # --- Fußzeile mit den Knöpfen ---
    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'
    $fuss.Height = 58
    $fuss.BackColor = $global:Farbe.Flaeche

    $trennerUnten = New-Object System.Windows.Forms.Panel
    $trennerUnten.Dock = 'Top'
    $trennerUnten.Height = 1
    $trennerUnten.BackColor = $global:Farbe.Rahmen
    $fuss.Controls.Add($trennerUnten)

    $knopfEinfuegen = Neuer-Knopf -Text 'Einfügen  (Strg+Enter)' -Breite 200 -Betont
    $knopfKopieren  = Neuer-Knopf -Text 'Nur kopieren' -Breite 140
    $knopfAbbrechen = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfEinfuegen.Anchor = 'Top,Right'
    $knopfKopieren.Anchor  = 'Top,Right'
    $knopfAbbrechen.Anchor = 'Top,Right'
    if ($NurVorschau) { $knopfEinfuegen.Visible = $false }

    $fuss.Controls.AddRange(@($knopfEinfuegen, $knopfKopieren, $knopfAbbrechen))

    $positioniereKnoepfe = {
        $rand = 16
        $y = 12
        $knopfEinfuegen.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - $rand - $knopfEinfuegen.Width), $y)
        $knopfKopieren.Location  = New-Object System.Drawing.Point(($knopfEinfuegen.Left - 10 - $knopfKopieren.Width), $y)
        $knopfAbbrechen.Location = New-Object System.Drawing.Point(($knopfKopieren.Left - 10 - $knopfAbbrechen.Width), $y)
    }

    # --- Mitte: links die Felder, rechts die Vorschau ---
    $mitte = New-Object System.Windows.Forms.SplitContainer
    $mitte.Dock = 'Fill'
    $mitte.Orientation = 'Vertical'
    $mitte.SplitterWidth = 8
    $mitte.BackColor = $global:Farbe.Hintergrund

    $linksRahmen = New-Object System.Windows.Forms.GroupBox
    $linksRahmen.Text = ' Angaben '
    $linksRahmen.Dock = 'Fill'
    $linksRahmen.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 8)

    $eingaben = New-Object System.Windows.Forms.Panel
    $eingaben.Dock = 'Fill'
    $eingaben.AutoScroll = $true
    $eingaben.BackColor = $global:Farbe.Flaeche
    $eingaben.Padding = New-Object System.Windows.Forms.Padding(12, 10, 12, 10)
    $linksRahmen.Controls.Add($eingaben)
    $mitte.Panel1.Controls.Add($linksRahmen)

    $rechtsRahmen = New-Object System.Windows.Forms.GroupBox
    $rechtsRahmen.Text = ' Vorschau '
    $rechtsRahmen.Dock = 'Fill'
    $rechtsRahmen.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 8)

    $vorschau = New-Object System.Windows.Forms.RichTextBox
    $vorschau.Dock = 'Fill'
    $vorschau.ReadOnly = $true
    $vorschau.BorderStyle = 'None'
    $vorschau.BackColor = $global:Farbe.Flaeche
    $vorschau.Font = $global:Schrift
    $vorschau.DetectUrls = $false
    $rechtsRahmen.Controls.Add($vorschau)
    $mitte.Panel2.Controls.Add($rechtsRahmen)

    $fenster.Controls.Add($mitte)
    $fenster.Controls.Add($fuss)
    $fenster.Controls.Add($kopf)

    # --- Für jedes Feld ein passendes Bedienelement bauen ---
    $steuerungen = New-Object System.Collections.ArrayList
    $breite = 400
    $erstes = $null

    foreach ($feld in $felder) {
        # Jedes Feld bekommt eine eigene Zeile als Behälter. Nur so lassen sich
        # abhängige Felder später ein- und ausblenden, ohne dass Lücken bleiben.
        $zeile = New-Object System.Windows.Forms.Panel
        $zeile.Width = $breite + 10
        $zeile.BackColor = $global:Farbe.Flaeche
        $zy = 0

        $beschriftung = Neue-Beschriftung -Text $feld.name -Fett
        $beschriftung.Location = New-Object System.Drawing.Point(0, $zy)
        $zeile.Controls.Add($beschriftung)
        $zy += $beschriftung.PreferredHeight + 3

        if (-not [string]::IsNullOrWhiteSpace($feld.hinweis)) {
            $hinweis = Neue-Beschriftung -Text $feld.hinweis -Klein
            $hinweis.MaximumSize = New-Object System.Drawing.Size($breite, 0)
            $hinweis.Location = New-Object System.Drawing.Point(0, $zy)
            $zeile.Controls.Add($hinweis)
            $zy += $hinweis.PreferredHeight + 4
        }

        $element = $null
        switch ([string]$feld.typ) {

            'auswahl' {
                $element = New-Object System.Windows.Forms.ComboBox
                $element.DropDownStyle = 'DropDownList'
                $element.Width = $breite
                $element.FlatStyle = 'Flat'
                foreach ($o in (Lies-Optionen $feld)) { [void]$element.Items.Add($o) }
                if ($element.Items.Count -gt 0) {
                    $element.SelectedIndex = 0
                    if (-not [string]::IsNullOrWhiteSpace($feld.standard)) {
                        for ($i = 0; $i -lt $element.Items.Count; $i++) {
                            if ($element.Items[$i].Anzeige -eq $feld.standard -or $element.Items[$i].Wert -eq $feld.standard) {
                                $element.SelectedIndex = $i; break
                            }
                        }
                    }
                }
            }

            'datum' {
                $element = New-Object System.Windows.Forms.DateTimePicker
                $element.Format = 'Custom'
                $element.CustomFormat = 'dd.MM.yyyy'
                $element.Width = 180
                $element.Value = Werte-Datum $feld.standard
            }

            'uhrzeit' {
                $element = New-Object System.Windows.Forms.DateTimePicker
                $element.Format = 'Custom'
                $element.CustomFormat = 'HH:mm'
                $element.ShowUpDown = $true
                $element.Width = 110
                if ($feld.standard -match '^\s*(\d{1,2})[:.](\d{2})\s*$') {
                    $element.Value = (Get-Date).Date.AddHours([int]$Matches[1]).AddMinutes([int]$Matches[2])
                } else {
                    $element.Value = Get-Date
                }
            }

            'zahl' {
                $element = New-Object System.Windows.Forms.NumericUpDown
                $element.Width = 120
                $element.Minimum = -1000000
                $element.Maximum = 1000000
                $element.ThousandsSeparator = $false
                $zahl = 0
                if ([int]::TryParse([string]$feld.standard, [ref]$zahl)) { $element.Value = $zahl }
            }

            'schalter' {
                $element = New-Object System.Windows.Forms.CheckBox
                $element.Text = 'ja — diesen Abschnitt einfügen'
                $element.Width = $breite
                $element.Checked = ("$($feld.standard)".ToLower() -notin @('nein', 'false', '0', 'aus'))
            }

            'mehrzeilig' {
                $element = Neues-Eingabefeld -Breite $breite -Mehrzeilig -Hoehe 84
                $element.Text = [string]$feld.standard
            }

            default {
                $element = Neues-Eingabefeld -Breite $breite
                $element.Text = [string]$feld.standard
            }
        }

        $element.Location = New-Object System.Drawing.Point(0, $zy)
        $element.Anchor = 'Top,Left'
        $zeile.Controls.Add($element)
        $zeile.Height = $zy + $element.Height

        $eingaben.Controls.Add($zeile)

        if ($null -eq $erstes) { $erstes = $element }
        [void]$steuerungen.Add([pscustomobject]@{ Feld = $feld; Element = $element; Zeile = $zeile; Sichtbar = $true })
    }

    if ($felder.Count -eq 0) {
        $leer = Neue-Beschriftung -Text 'Dieser Baustein hat keine Auswahlfelder — der Text wird unverändert eingefügt.' -Klein
        $leer.MaximumSize = New-Object System.Drawing.Size($breite, 0)
        $leer.Location = New-Object System.Drawing.Point(4, 6)
        $eingaben.Controls.Add($leer)
    }

    # --- Sichtbarkeit rechnen, Werte einsammeln, Vorschau aktualisieren ---

    # Was der Anwender im Feld sieht. Genau damit vergleichen die Bedingungen —
    # „Herr" ist verständlicher als der eingefügte Text „Sehr geehrter Herr".
    $anzeigeWert = {
        param($s)
        switch ([string]$s.Feld.typ) {
            'auswahl'  { if ($s.Element.SelectedItem) { return [string]$s.Element.SelectedItem.Anzeige } else { return '' } }
            'schalter' { if ($s.Element.Checked) { return 'ja' } else { return 'nein' } }
            'datum'    { return $s.Element.Value.ToString('dd.MM.yyyy') }
            'uhrzeit'  { return $s.Element.Value.ToString('HH:mm') }
            'zahl'     { return [string]([int]$s.Element.Value) }
            default    { return [string]$s.Element.Text }
        }
    }.GetNewClosure()

    $berechneSichtbarkeit = {
        foreach ($s in $steuerungen) { $s.Sichtbar = $true }
        # Mehrere Runden, damit auch Ketten aufgehen: A blendet B ein, B blendet C ein.
        for ($runde = 0; $runde -lt 6; $runde++) {
            $geaendert = $false
            foreach ($s in $steuerungen) {
                $soll = $true
                $quellname = [string]$s.Feld.zeigen_wenn_feld
                if (-not [string]::IsNullOrWhiteSpace($quellname)) {
                    $quelle = $null
                    foreach ($k in $steuerungen) { if ([string]$k.Feld.name -eq $quellname) { $quelle = $k; break } }
                    if ($null -eq $quelle) { $soll = $true }              # Bedingung zeigt ins Leere
                    elseif (-not $quelle.Sichtbar) { $soll = $false }     # Auslöser selbst ausgeblendet
                    else { $soll = ((& $anzeigeWert $quelle) -eq [string]$s.Feld.zeigen_wenn_wert) }
                }
                if ($s.Sichtbar -ne $soll) { $s.Sichtbar = $soll; $geaendert = $true }
            }
            if (-not $geaendert) { break }
        }
    }.GetNewClosure()

    <#
        Setzt die sichtbaren Zeilen untereinander. Läuft bei jeder Eingabe, weil
        sich dadurch die Sichtbarkeit abhängiger Felder ändern kann.

        Zwei Fallstricke stecken darin.

        Erstens zählt Location in einem Bildlauf-Bereich ab dem **sichtbaren**
        Rand, nicht ab dem Anfang des Inhalts. Wer geblättert hat, muss die
        Bildlaufstelle also mitrechnen — sonst wandern die Zeilen bei jedem
        Neuordnen gegen den Bildlauf, und Windows klemmt die Stelle am Ende
        zurück. Genau das sah aus wie ein Springen kurz vor dem Ende.

        Zweitens wird gar nicht erst neu geordnet, wenn alles schon an seiner
        Stelle steht. Das ist beim Tippen der Regelfall — jedes Zeichen löst
        einen Durchlauf aus.

        AutoScrollPosition meldet negative Werte, verlangt beim Setzen aber
        positive; daher die Beträge.
    #>
    $ordneZeilen = {
        $versatz = $eingaben.AutoScrollPosition.Y
        $zeilenbreite = [Math]::Max(320, $eingaben.ClientSize.Width - 20)

        # Zielstellen im Inhalt ausrechnen und mit dem Ist vergleichen
        $ziele = New-Object System.Collections.ArrayList
        $oben = 6
        $noetig = $false
        foreach ($s in $steuerungen) {
            if ($s.Sichtbar) {
                [void]$ziele.Add($oben)
                if (($s.Zeile.Top - $versatz) -ne $oben -or -not $s.Zeile.Visible -or $s.Zeile.Width -ne $zeilenbreite) {
                    $noetig = $true
                }
                $oben += $s.Zeile.Height + 16
            } else {
                [void]$ziele.Add($null)
                if ($s.Zeile.Visible) { $noetig = $true }
            }
        }
        if (-not $noetig) { return }

        $merke = $eingaben.AutoScrollPosition
        $eingaben.SuspendLayout()
        for ($i = 0; $i -lt $steuerungen.Count; $i++) {
            $s = $steuerungen[$i]
            if ($null -eq $ziele[$i]) { $s.Zeile.Visible = $false; continue }
            $s.Zeile.Location = New-Object System.Drawing.Point(4, ($ziele[$i] + $merke.Y))
            $s.Zeile.Width = $zeilenbreite
            $s.Zeile.Visible = $true
        }
        $eingaben.ResumeLayout()
        $eingaben.PerformLayout()
        $eingaben.AutoScrollPosition = New-Object System.Drawing.Point([Math]::Abs($merke.X), [Math]::Abs($merke.Y))
    }.GetNewClosure()

    $holeWerte = {
        $werte = @{}
        foreach ($s in $steuerungen) {
            $f = $s.Feld
            $e = $s.Element
            # Ausgeblendete Felder zählen als leer. Sonst stünde ihr Inhalt im Text,
            # obwohl der Anwender sie nie zu Gesicht bekommen hat.
            if (-not $s.Sichtbar) { $werte[$f.name] = ''; continue }
            switch ([string]$f.typ) {
                'auswahl'  { $werte[$f.name] = if ($e.SelectedItem) { $e.SelectedItem.Wert } else { '' } }
                'datum'    { $werte[$f.name] = $e.Value.ToString('dd.MM.yyyy') }
                'uhrzeit'  { $werte[$f.name] = $e.Value.ToString('HH:mm') }
                'zahl'     { $werte[$f.name] = [string]([int]$e.Value) }
                'schalter' { $werte[$f.name] = if ($e.Checked) { [string]$f.wenn_ja } else { [string]$f.wenn_nein } }
                default    { $werte[$f.name] = [string]$e.Text }
            }
        }
        return $werte
    }.GetNewClosure()

    $aktualisiere = {
        & $berechneSichtbarkeit
        & $ordneZeilen
        $erg = Ersetze-Platzhalter-Rtf -Rtf (Hole-Baustein-Rtf $Baustein) -Werte (& $holeWerte)
        # Erst merken, dann anzeigen: die rote Markierung offener Platzhalter
        # soll nicht im eingefügten Text landen.
        $global:AssistentText = $erg.Text
        $global:AssistentRtf  = $erg.Rtf
        $vorschau.Rtf = $erg.Rtf
        Faerbe-Platzhalter $vorschau
    }.GetNewClosure()

    <#
        Das Feld, in dem gerade geschrieben wird, bekommt einen hellblauen
        Streifen und wird in den sichtbaren Bereich geholt. Bei einem Baustein
        mit zehn Feldern verliert man sonst schnell die Stelle.
    #>
    $hervorheben = {
        param($absender, $e)
        foreach ($s in $steuerungen) {
            if ($s.Element -ne $absender) { $s.Zeile.BackColor = $global:Farbe.Flaeche; continue }
            $s.Zeile.BackColor = $global:Farbe.AkzentHell

            <#
                Die Zeile in den sichtbaren Bereich holen. ScrollControlIntoView
                bleibt im Enter-Ereignis wirkungslos, deshalb wird von Hand
                gerechnet: Zeile.Top zählt ab dem sichtbaren Rand und wird beim
                Blättern negativ; AutoScrollPosition meldet negative Werte,
                verlangt beim Setzen aber positive.
            #>
            $inhaltOben = $s.Zeile.Top - $eingaben.AutoScrollPosition.Y
            $sichtbar = $eingaben.ClientSize.Height
            $neueStelle = $null
            if ($s.Zeile.Top -lt 0) {
                $neueStelle = $inhaltOben - 8                                    # steht oben raus
            } elseif (($s.Zeile.Top + $s.Zeile.Height) -gt $sichtbar) {
                $neueStelle = $inhaltOben + $s.Zeile.Height - $sichtbar + 8      # steht unten raus
            }
            if ($null -ne $neueStelle) {
                # Nicht über den Anschlag hinaus: sonst zieht das nächste
                # Neuordnen die Stelle zurück, und das sieht aus wie ein Ruck.
                $anschlag = [Math]::Max(0, $eingaben.DisplayRectangle.Height - $eingaben.ClientSize.Height)
                $neueStelle = [Math]::Min($anschlag, [Math]::Max(0, $neueStelle))
                $eingaben.AutoScrollPosition = New-Object System.Drawing.Point(0, $neueStelle)
                # Gleich einmal durchordnen, damit sich die Stelle jetzt setzt und
                # nicht erst beim nächsten getippten Zeichen — das wäre ein Ruck.
                & $ordneZeilen
            }
        }
    }.GetNewClosure()

    foreach ($s in $steuerungen) {
        $e = $s.Element
        $e.Add_Enter($hervorheben)
        switch ([string]$s.Feld.typ) {
            'auswahl'  { $e.Add_SelectedIndexChanged($aktualisiere) }
            'datum'    { $e.Add_ValueChanged($aktualisiere) }
            'uhrzeit'  { $e.Add_ValueChanged($aktualisiere) }
            'zahl'     { $e.Add_ValueChanged($aktualisiere) }
            'schalter' { $e.Add_CheckedChanged($aktualisiere) }
            default    { $e.Add_TextChanged($aktualisiere) }
        }
    }

    # --- Knöpfe verdrahten ---
    $global:AssistentErgebnis = $null
    $global:AssistentAktion   = 'abbruch'

    $knopfEinfuegen.Add_Click({
        $global:AssistentErgebnis = $global:AssistentText
        $global:AssistentAktion   = 'einfuegen'
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $knopfKopieren.Add_Click({
        $global:AssistentErgebnis = $global:AssistentText
        $global:AssistentAktion   = 'kopieren'
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $knopfAbbrechen.Add_Click({
        $global:AssistentAktion = 'abbruch'
        $fenster.DialogResult = 'Cancel'
        $fenster.Close()
    }.GetNewClosure())

    $fuss.Add_Resize($positioniereKnoepfe)

    $fenster.Add_KeyDown({
        param($absender, $e)
        if ($e.KeyCode -eq 'Escape') {
            $global:AssistentAktion = 'abbruch'
            $fenster.DialogResult = 'Cancel'
            $fenster.Close()
        } elseif ($e.Control -and $e.KeyCode -eq 'Return') {
            if ($knopfEinfuegen.Visible) { $knopfEinfuegen.PerformClick() } else { $knopfKopieren.PerformClick() }
        }
    }.GetNewClosure())

    $fenster.Add_Shown({
        # Ohne das kann Windows das Fenster im Hintergrund lassen, wenn es aus
        # einem Zusammenhang ohne eigenen Vordergrund heraus geöffnet wurde —
        # etwa bei der Kürzel-Erkennung, ausgelöst aus einem fremden Programm.
        [DocKit.Windows]::FokusZurueck($fenster.Handle)
        $mitte.SplitterDistance = [int]($mitte.ClientSize.Width * 0.46)
        & $positioniereKnoepfe
        & $aktualisiere
        # In das erste Feld springen, das tatsächlich sichtbar ist
        $zuerst = $null
        foreach ($s in $steuerungen) { if ($s.Sichtbar) { $zuerst = $s.Element; break } }
        if ($null -eq $zuerst) { $zuerst = $erstes }
        if ($zuerst) { [void]$zuerst.Focus() }
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $ergebnis = [pscustomobject]@{
        Aktion = $global:AssistentAktion
        Text   = $global:AssistentErgebnis
        Rtf    = $global:AssistentRtf
    }
    $fenster.Dispose()
    return $ergebnis
}


<#
    Kleine Auswahlliste über alle Textbausteine. Wird gebraucht, wenn beim Anlegen
    einer Vorlagenkopie gleich ein Baustein hineingeschrieben werden soll.
    Rückgabe: der gewählte Baustein oder $null.
#>
<#
    Legt fest, was eine Vorlage ist und wohin ein Textbaustein in ihr gehört.
    Die übergebene Vorlage wird bei "Übernehmen" unmittelbar geändert.
#>
function Zeige-Vorlageneditor {
    param($Vorlage)

    foreach ($p in @('einfuegen_art', 'einfuegen_marke', 'oeffnen_danach')) {
        if ($null -eq $Vorlage.PSObject.Properties[$p]) {
            $wert = switch ($p) { 'einfuegen_art' { 'marke' } 'einfuegen_marke' { '{Textbaustein}' } default { $true } }
            Add-Member -InputObject $Vorlage -MemberType NoteProperty -Name $p -Value $wert
        }
    }

    $fenster = Neues-Fenster -Titel 'Vorlage bearbeiten' -Breite 640 -Hoehe 560 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $lName = Neue-Beschriftung -Text 'Name in der Schnellwahl' -Fett
    $eName = Neues-Eingabefeld -Breite 580
    $eName.Anchor = 'Top,Left,Right'
    $eName.Text = [string]$Vorlage.name

    $lKat = Neue-Beschriftung -Text 'Kategorie' -Fett
    $eKatV = New-Object System.Windows.Forms.ComboBox
    $eKatV.DropDownStyle = 'DropDown'          # frei beschreibbar
    $eKatV.Width = 280
    foreach ($k in @(@($global:Vorlagen) | Where-Object { $_ } | ForEach-Object { [string]$_.kategorie } | Sort-Object -Unique)) {
        if ($k) { [void]$eKatV.Items.Add($k) }
    }
    foreach ($k in @('Briefkopf', 'Vermerk', 'Bescheid', 'Formular')) {
        if (-not $eKatV.Items.Contains($k)) { [void]$eKatV.Items.Add($k) }
    }
    $eKatV.Text = if ($Vorlage.kategorie) { [string]$Vorlage.kategorie } else { 'Vorlagen' }
    $hKat = Neue-Beschriftung -Text 'auswählen oder neue eintippen — gruppiert die Vorlagen in der Übersicht' -Klein

    $lBesch = Neue-Beschriftung -Text 'Wofür ist die Vorlage? (optional)' -Fett
    $eBesch = Neues-Eingabefeld -Breite 580
    $eBesch.Anchor = 'Top,Left,Right'
    $eBesch.Text = [string]$Vorlage.beschreibung

    $lPfad = Neue-Beschriftung -Text 'Datei' -Fett
    $ePfad = Neues-Eingabefeld -Breite 470
    $ePfad.Anchor = 'Top,Left,Right'
    $ePfad.Text = [string]$Vorlage.pfad
    $ePfad.ReadOnly = $true
    $ePfad.BackColor = $global:Farbe.Hintergrund
    $knopfDatei = Neuer-Knopf -Text 'Andere …' -Breite 100 -Hoehe 26
    $knopfDatei.Anchor = 'Top,Right'

    $lArt = Neue-Beschriftung -Text 'Wohin soll ein Textbaustein in der Kopie geschrieben werden?' -Fett
    $cbArt = New-Object System.Windows.Forms.ComboBox
    $cbArt.DropDownStyle = 'DropDownList'; $cbArt.Width = 400
    [void]$cbArt.Items.Add((New-Object DocKit.Option('An eine Marke im Text — z. B. {Textbaustein}', 'marke')))
    [void]$cbArt.Items.Add((New-Object DocKit.Option('An eine Word-Textmarke (Lesezeichen)', 'textmarke')))
    [void]$cbArt.Items.Add((New-Object DocKit.Option('Ans Ende des Dokuments', 'ende')))
    [void]$cbArt.Items.Add((New-Object DocKit.Option('Gar nicht — nur die Datei kopieren', 'keine')))
    for ($i = 0; $i -lt $cbArt.Items.Count; $i++) {
        if ($cbArt.Items[$i].Wert -eq [string]$Vorlage.einfuegen_art) { $cbArt.SelectedIndex = $i; break }
    }
    if ($cbArt.SelectedIndex -lt 0) { $cbArt.SelectedIndex = 0 }

    $lMarke = Neue-Beschriftung -Text 'Marke' -Fett
    $eMarke = Neues-Eingabefeld -Breite 300
    $eMarke.Text = [string]$Vorlage.einfuegen_marke
    $hMarke = Neue-Beschriftung -Text '' -Klein
    $hMarke.MaximumSize = New-Object System.Drawing.Size(580, 0)

    $cOeffnen = New-Object System.Windows.Forms.CheckBox
    $cOeffnen.Text = 'Die Kopie nach dem Anlegen gleich öffnen'
    $cOeffnen.AutoSize = $true
    $cOeffnen.Checked = [bool]$Vorlage.oeffnen_danach

    $y = 20
    Setze-Unter $flaeche $lName    ([ref]$y) 20 3
    Setze-Unter $flaeche $eName    ([ref]$y) 20 14
    Setze-Unter $flaeche $lKat     ([ref]$y) 20 3
    Setze-Unter $flaeche $eKatV    ([ref]$y) 20 3
    Setze-Unter $flaeche $hKat     ([ref]$y) 20 14
    Setze-Unter $flaeche $lBesch   ([ref]$y) 20 3
    Setze-Unter $flaeche $eBesch   ([ref]$y) 20 14
    Setze-Unter $flaeche $lPfad    ([ref]$y) 20 3
    $zeilePfad = $y
    Setze-Unter $flaeche $ePfad    ([ref]$y) 20 16
    $knopfDatei.Location = New-Object System.Drawing.Point(500, ($zeilePfad - 1))
    $flaeche.Controls.Add($knopfDatei)
    Setze-Unter $flaeche $lArt     ([ref]$y) 20 4
    Setze-Unter $flaeche $cbArt    ([ref]$y) 20 14
    Setze-Unter $flaeche $lMarke   ([ref]$y) 20 3
    Setze-Unter $flaeche $eMarke   ([ref]$y) 20 4
    Setze-Unter $flaeche $hMarke   ([ref]$y) 20 16
    Setze-Unter $flaeche $cOeffnen ([ref]$y) 20 16

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 56; $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)
    $fenster.ClientSize = New-Object System.Drawing.Size(620, ($cOeffnen.Bottom + 24 + $fuss.Height))

    $zeigeMarke = {
        $art = [string]$cbArt.SelectedItem.Wert
        $anMarke = ($art -eq 'marke' -or $art -eq 'textmarke')
        foreach ($c in @($lMarke, $eMarke)) { $c.Visible = $anMarke }
        $hMarke.Text = switch ($art) {
            'marke'     { 'Schreibe diese Zeichenfolge einmal in deine Vorlage — an genau die Stelle, an der der Baustein erscheinen soll. Sie wird beim Einfügen ersetzt.' }
            'textmarke' { 'Name einer Textmarke in Word: Einfügen → Links → Textmarke. Sie ist unsichtbar und bleibt beim Bearbeiten erhalten.' }
            'ende'      { 'Der Baustein wird unten an das Dokument angehängt.' }
            default     { 'Es wird nur die Datei kopiert; nach einem Baustein wird gar nicht erst gefragt.' }
        }
    }.GetNewClosure()

    $cbArt.Add_SelectedIndexChanged($zeigeMarke)

    $knopfDatei.Add_Click({
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Title = 'Vorlagendatei wählen'
        $d.Filter = 'Alle Dateien (*.*)|*.*'
        if ($ePfad.Text -and (Test-Path -LiteralPath $ePfad.Text)) { $d.InitialDirectory = Split-Path -Parent $ePfad.Text }
        if ($d.ShowDialog() -eq 'OK') {
            $ePfad.Text = $d.FileName
            if (-not $eName.Text.Trim()) { $eName.Text = [System.IO.Path]::GetFileNameWithoutExtension($d.FileName) }
        }
    }.GetNewClosure())

    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if ([string]::IsNullOrWhiteSpace($eName.Text)) {
            Zeige-Meldung 'Bitte einen Namen vergeben.' 'Name fehlt' 'Warning'; return
        }
        if ([string]::IsNullOrWhiteSpace($ePfad.Text)) {
            Zeige-Meldung 'Bitte eine Datei wählen.' 'Datei fehlt' 'Warning'; return
        }
        $art = [string]$cbArt.SelectedItem.Wert
        if (($art -eq 'marke' -or $art -eq 'textmarke') -and [string]::IsNullOrWhiteSpace($eMarke.Text)) {
            Zeige-Meldung 'Bitte die Marke angeben, an der der Baustein landen soll.' 'Marke fehlt' 'Warning'; return
        }
        $Vorlage.name            = $eName.Text.Trim()
        $Vorlage.kategorie       = $(if ($eKatV.Text.Trim()) { $eKatV.Text.Trim() } else { 'Vorlagen' })
        $Vorlage.beschreibung    = $eBesch.Text
        $Vorlage.pfad            = $ePfad.Text
        $Vorlage.einfuegen_art   = $art
        $Vorlage.einfuegen_marke = $eMarke.Text.Trim()
        $Vorlage.oeffnen_danach  = $cOeffnen.Checked
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({ & $ordne; & $zeigeMarke; [void]$eName.Focus() }.GetNewClosure())

    $ergebnis = ($fenster.ShowDialog() -eq 'OK')
    $fenster.Dispose()
    return $ergebnis
}

<#
    Verknüpft eine Vorlage mit einem Baustein unter einem gemeinsamen Namen.
    Referenziert wird über die Kennung — Vorlage und Baustein bleiben also auch
    verknüpft, wenn sie später umbenannt werden.
#>
<#
    Ein einzelner Baustein innerhalb einer Kombination: welcher Baustein es ist
    und wohin er geschrieben wird. Anders als bei einer Vorlage gibt es hier
    kein »nur kopieren« — wer einen Baustein verknüpft, will ihn auch an
    einer Stelle landen sehen.
#>
function Zeige-Kombinationsbaustein-Editor {
    param($Eintrag)

    $fenster = Neues-Fenster -Titel 'Baustein in der Kombination' -Breite 560 -Hoehe 400 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $lBaustein = Neue-Beschriftung -Text 'Baustein' -Fett
    $cbBaustein = New-Object System.Windows.Forms.ComboBox
    $cbBaustein.DropDownStyle = 'DropDownList'; $cbBaustein.Width = 500
    foreach ($b in @($global:Bausteine | Where-Object { $_ } | Sort-Object name)) {
        [void]$cbBaustein.Items.Add((New-Object DocKit.Option($b.name, $b.id)))
    }
    for ($i = 0; $i -lt $cbBaustein.Items.Count; $i++) {
        if ($cbBaustein.Items[$i].Wert -eq [string]$Eintrag.baustein_id) { $cbBaustein.SelectedIndex = $i; break }
    }

    $lArt = Neue-Beschriftung -Text 'Wohin soll dieser Baustein geschrieben werden?' -Fett
    $cbArt = New-Object System.Windows.Forms.ComboBox
    $cbArt.DropDownStyle = 'DropDownList'; $cbArt.Width = 400
    [void]$cbArt.Items.Add((New-Object DocKit.Option('An eine Marke im Text — z. B. {Textbaustein}', 'marke')))
    [void]$cbArt.Items.Add((New-Object DocKit.Option('An eine Word-Textmarke (Lesezeichen)', 'textmarke')))
    [void]$cbArt.Items.Add((New-Object DocKit.Option('Ans Ende des Dokuments', 'ende')))
    for ($i = 0; $i -lt $cbArt.Items.Count; $i++) {
        if ($cbArt.Items[$i].Wert -eq [string]$Eintrag.einfuegen_art) { $cbArt.SelectedIndex = $i; break }
    }
    if ($cbArt.SelectedIndex -lt 0) { $cbArt.SelectedIndex = 0 }

    $lMarke = Neue-Beschriftung -Text 'Marke' -Fett
    $eMarke = Neues-Eingabefeld -Breite 300
    $eMarke.Text = [string]$Eintrag.einfuegen_marke
    $hMarke = Neue-Beschriftung -Text '' -Klein
    $hMarke.MaximumSize = New-Object System.Drawing.Size(500, 0)

    $y = 20
    Setze-Unter $flaeche $lBaustein  ([ref]$y) 20 3
    Setze-Unter $flaeche $cbBaustein ([ref]$y) 20 14
    Setze-Unter $flaeche $lArt       ([ref]$y) 20 4
    Setze-Unter $flaeche $cbArt      ([ref]$y) 20 14
    Setze-Unter $flaeche $lMarke     ([ref]$y) 20 3
    Setze-Unter $flaeche $eMarke     ([ref]$y) 20 4
    Setze-Unter $flaeche $hMarke     ([ref]$y) 20 16

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 56; $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)
    $fenster.ClientSize = New-Object System.Drawing.Size(560, ($hMarke.Bottom + 24 + $fuss.Height))

    $zeigeMarke = {
        $art = [string]$cbArt.SelectedItem.Wert
        $anMarke = ($art -eq 'marke' -or $art -eq 'textmarke')
        foreach ($c in @($lMarke, $eMarke)) { $c.Visible = $anMarke }
        $hMarke.Text = switch ($art) {
            'marke'     { 'Schreibe diese Zeichenfolge einmal in deine Vorlage — an genau die Stelle, an der dieser Baustein erscheinen soll.' }
            'textmarke' { 'Name einer Textmarke in Word: Einfügen → Links → Textmarke.' }
            default     { 'Der Baustein wird unten an das Dokument angehängt.' }
        }
    }.GetNewClosure()
    $cbArt.Add_SelectedIndexChanged($zeigeMarke)

    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if ($null -eq $cbBaustein.SelectedItem) {
            Zeige-Meldung 'Bitte einen Baustein wählen.' 'Baustein fehlt' 'Warning'; return
        }
        $art = [string]$cbArt.SelectedItem.Wert
        if (($art -eq 'marke' -or $art -eq 'textmarke') -and [string]::IsNullOrWhiteSpace($eMarke.Text)) {
            Zeige-Meldung 'Bitte die Marke angeben, an der der Baustein landen soll.' 'Marke fehlt' 'Warning'; return
        }
        $Eintrag.baustein_id     = [string]$cbBaustein.SelectedItem.Wert
        $Eintrag.einfuegen_art   = $art
        $Eintrag.einfuegen_marke = $eMarke.Text.Trim()
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({ & $ordne; & $zeigeMarke; [void]$cbBaustein.Focus() }.GetNewClosure())

    $ergebnis = ($fenster.ShowDialog() -eq 'OK')
    $fenster.Dispose()
    return $ergebnis
}

function Zeige-Kombinationseditor {
    param($Kombination)

    $fenster = Neues-Fenster -Titel 'Kombination bearbeiten' -Breite 620 -Hoehe 620 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $lName = Neue-Beschriftung -Text 'Name in der Schnellwahl' -Fett
    $eName = Neues-Eingabefeld -Breite 580
    $eName.Anchor = 'Top,Left,Right'
    $eName.Text = [string]$Kombination.name

    $lKat = Neue-Beschriftung -Text 'Kategorie' -Fett
    $eKatK = New-Object System.Windows.Forms.ComboBox
    $eKatK.DropDownStyle = 'DropDown'          # frei beschreibbar
    $eKatK.Width = 280
    foreach ($k in @(@($global:Kombinationen) | Where-Object { $_ } | ForEach-Object { [string]$_.kategorie } | Sort-Object -Unique)) {
        if ($k) { [void]$eKatK.Items.Add($k) }
    }
    $eKatK.Text = if ($Kombination.kategorie) { [string]$Kombination.kategorie } else { 'Allgemein' }
    $hKat = Neue-Beschriftung -Text 'auswählen oder neue eintippen — gruppiert die Kombinationen in der Übersicht' -Klein

    $lVorlage = Neue-Beschriftung -Text 'Vorlage' -Fett
    $cbVorlage = New-Object System.Windows.Forms.ComboBox
    $cbVorlage.DropDownStyle = 'DropDownList'; $cbVorlage.Width = 580
    foreach ($v in @($global:Vorlagen | Where-Object { $_ } | Sort-Object name)) {
        [void]$cbVorlage.Items.Add((New-Object DocKit.Option($v.name, $v.id)))
    }
    for ($i = 0; $i -lt $cbVorlage.Items.Count; $i++) {
        if ($cbVorlage.Items[$i].Wert -eq [string]$Kombination.vorlage_id) { $cbVorlage.SelectedIndex = $i; break }
    }

    $lBaustein = Neue-Beschriftung -Text 'Bausteine in dieser Kombination — jeder mit eigenem Ankerpunkt' -Fett

    $baustHuelle = New-Object System.Windows.Forms.Panel
    $baustHuelle.Width = 580; $baustHuelle.Height = 160
    $baustHuelle.BorderStyle = 'FixedSingle'

    $baustListe = New-Object System.Windows.Forms.ListView
    $baustListe.Dock = 'Fill'; $baustListe.View = 'Details'; $baustListe.FullRowSelect = $true
    $baustListe.MultiSelect = $false; $baustListe.HideSelection = $false
    $baustListe.HeaderStyle = 'Nonclickable'; $baustListe.BorderStyle = 'None'
    $baustListe.BackColor = $global:Farbe.Flaeche
    [void]$baustListe.Columns.Add('Baustein', 250)
    [void]$baustListe.Columns.Add('Wohin', 190)

    $baustKnoepfe = New-Object System.Windows.Forms.Panel
    $baustKnoepfe.Dock = 'Right'; $baustKnoepfe.Width = 130; $baustKnoepfe.BackColor = $global:Farbe.Hintergrund
    $kBaustNeu   = Neuer-Knopf -Text 'Neu' -Breite 118 -Hoehe 28
    $kBaustBearb = Neuer-Knopf -Text 'Bearbeiten' -Breite 118 -Hoehe 28
    $kBaustWeg   = Neuer-Knopf -Text 'Entfernen' -Breite 118 -Hoehe 28
    $kBaustNeu.Location   = New-Object System.Drawing.Point(6, 2)
    $kBaustBearb.Location = New-Object System.Drawing.Point(6, 36)
    $kBaustWeg.Location   = New-Object System.Drawing.Point(6, 70)
    $baustKnoepfe.Controls.AddRange(@($kBaustNeu, $kBaustBearb, $kBaustWeg))

    $baustHuelle.Controls.Add($baustListe)
    $baustHuelle.Controls.Add($baustKnoepfe)

    $lBesch = Neue-Beschriftung -Text 'Wofür ist die Kombination? (optional)' -Fett
    $eBesch = Neues-Eingabefeld -Breite 580
    $eBesch.Anchor = 'Top,Left,Right'
    $eBesch.Text = [string]$Kombination.beschreibung

    $y = 20
    Setze-Unter $flaeche $lName      ([ref]$y) 20 3
    Setze-Unter $flaeche $eName      ([ref]$y) 20 14
    Setze-Unter $flaeche $lKat       ([ref]$y) 20 3
    Setze-Unter $flaeche $eKatK      ([ref]$y) 20 3
    Setze-Unter $flaeche $hKat       ([ref]$y) 20 14
    Setze-Unter $flaeche $lVorlage   ([ref]$y) 20 3
    Setze-Unter $flaeche $cbVorlage  ([ref]$y) 20 14
    Setze-Unter $flaeche $lBaustein  ([ref]$y) 20 3
    Setze-Unter $flaeche $baustHuelle ([ref]$y) 20 14
    Setze-Unter $flaeche $lBesch     ([ref]$y) 20 3
    Setze-Unter $flaeche $eBesch     ([ref]$y) 20 14

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 56; $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)
    $fenster.ClientSize = New-Object System.Drawing.Size(620, ($eBesch.Bottom + 24 + $fuss.Height))

    <#
        Eigene Arbeitsliste statt direkt auf $Kombination.bausteine: So bleibt
        die Kombination unverändert, wenn der Dialog mit Abbrechen verlassen
        wird — genau wie bei den übrigen Feldern, die auch erst beim
        Übernehmen zurückgeschrieben werden.
    #>
    $arbeitsListe = New-Object System.Collections.ArrayList
    foreach ($b in @($Kombination.bausteine)) { if ($b) { [void]$arbeitsListe.Add($b) } }

    $zeigeBausteinListe = {
        $baustListe.BeginUpdate(); $baustListe.Items.Clear()
        foreach ($b in @($arbeitsListe)) {
            $bBaustein = @($global:Bausteine) | Where-Object { $_ -and $_.id -eq $b.baustein_id } | Select-Object -First 1
            $e = New-Object System.Windows.Forms.ListViewItem($(if ($bBaustein) { [string]$bBaustein.name } else { '— fehlt —' }))
            $wohin = switch ([string]$b.einfuegen_art) {
                'textmarke' { "Textmarke »$($b.einfuegen_marke)«" }
                'ende'      { 'Ende des Dokuments' }
                default     { "Marke $($b.einfuegen_marke)" }
            }
            [void]$e.SubItems.Add($wohin)
            if ($null -eq $bBaustein) { $e.ForeColor = $global:Farbe.Warnung }
            $e.Tag = $b
            [void]$baustListe.Items.Add($e)
        }
        $baustListe.EndUpdate()
    }.GetNewClosure()

    $gewaehlterEintrag = {
        if ($baustListe.SelectedItems.Count -eq 0) { return $null }
        return $baustListe.SelectedItems[0].Tag
    }.GetNewClosure()

    $kBaustNeu.Add_Click({
        if (@($global:Bausteine).Count -eq 0) {
            Zeige-Meldung 'Es gibt noch keine Bausteine, die sich verknüpfen ließen.' 'Noch nichts zum Verknüpfen' 'Warning'
            return
        }
        $neu = Neuer-Kombinations-Baustein
        if (Zeige-Kombinationsbaustein-Editor -Eintrag $neu) {
            [void]$arbeitsListe.Add($neu)
            & $zeigeBausteinListe
        }
    }.GetNewClosure())

    $bearbeiteEintrag = {
        $b = & $gewaehlterEintrag
        if ($null -eq $b) { return }
        if (Zeige-Kombinationsbaustein-Editor -Eintrag $b) { & $zeigeBausteinListe }
    }.GetNewClosure()
    $kBaustBearb.Add_Click($bearbeiteEintrag)
    $baustListe.Add_DoubleClick($bearbeiteEintrag)

    $kBaustWeg.Add_Click({
        $b = & $gewaehlterEintrag
        if ($null -eq $b) { return }
        [void]$arbeitsListe.Remove($b)
        & $zeigeBausteinListe
    }.GetNewClosure())

    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if ([string]::IsNullOrWhiteSpace($eName.Text)) {
            Zeige-Meldung 'Bitte einen Namen vergeben.' 'Name fehlt' 'Warning'; return
        }
        if ($null -eq $cbVorlage.SelectedItem) {
            Zeige-Meldung 'Bitte eine Vorlage wählen.' 'Vorlage fehlt' 'Warning'; return
        }
        if ($arbeitsListe.Count -eq 0) {
            Zeige-Meldung 'Bitte mindestens einen Baustein hinzufügen.' 'Baustein fehlt' 'Warning'; return
        }
        $Kombination.name         = $eName.Text.Trim()
        $Kombination.kategorie    = $(if ($eKatK.Text.Trim()) { $eKatK.Text.Trim() } else { 'Allgemein' })
        $Kombination.beschreibung = $eBesch.Text
        $Kombination.vorlage_id   = [string]$cbVorlage.SelectedItem.Wert
        $Kombination.bausteine    = $arbeitsListe
        if ($null -ne $Kombination.PSObject.Properties['geaendert_von']) {
            $Kombination.geaendert_von = $env:USERNAME
            $Kombination.geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        }
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({ & $ordne; & $zeigeBausteinListe; [void]$eName.Focus() }.GetNewClosure())

    $ergebnis = ($fenster.ShowDialog() -eq 'OK')
    $fenster.Dispose()
    return $ergebnis
}

function Waehle-Baustein {
    param([string]$Titel = 'Welcher Textbaustein soll hinein?')

    $fenster = Neues-Fenster -Titel $Titel -Breite 720 -Hoehe 480
    $fenster.MinimumSize = New-Object System.Drawing.Size(560, 380)

    $kopf = New-Object System.Windows.Forms.Panel
    $kopf.Dock = 'Top'; $kopf.Height = 58; $kopf.BackColor = $global:Farbe.Flaeche
    $kopf.Padding = New-Object System.Windows.Forms.Padding(14, 10, 14, 10)
    $suchfeld = New-Object System.Windows.Forms.TextBox
    $suchfeld.Dock = 'Fill'; $suchfeld.Font = $global:SchriftSuche; $suchfeld.BorderStyle = 'FixedSingle'
    $kopf.Controls.Add($suchfeld)

    $liste = New-Object System.Windows.Forms.ListView
    $liste.Dock = 'Fill'; $liste.View = 'Details'; $liste.FullRowSelect = $true
    $liste.MultiSelect = $false; $liste.HideSelection = $false
    $liste.HeaderStyle = 'Nonclickable'; $liste.BorderStyle = 'None'
    $liste.BackColor = $global:Farbe.Flaeche; $liste.ShowGroups = $true
    [void]$liste.Columns.Add('Baustein', 260)
    [void]$liste.Columns.Add('Wofür', 400)

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 54; $fuss.BackColor = $global:Farbe.Flaeche
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 150 -Betont
    $knopfAus = Neuer-Knopf -Text 'Ohne Baustein' -Breite 150
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))

    $fenster.Controls.Add($liste); $fenster.Controls.Add($fuss); $fenster.Controls.Add($kopf)

    $global:BausteinwahlErgebnis = $null

    $fuelle = {
        $begriffe = @(($suchfeld.Text.Trim()) -split '\s+' | Where-Object { $_ })
        $liste.BeginUpdate(); $liste.Items.Clear(); $liste.Groups.Clear()
        $gruppen = @{}
        foreach ($b in @($global:Bausteine | Sort-Object @{ Expression = 'kategorie' }, @{ Expression = 'name' })) {
            $heu = "$($b.name) $($b.kategorie) $($b.kuerzel) $($b.beschreibung)"
            $passt = $true
            foreach ($t in $begriffe) { if ($heu -notlike "*$t*") { $passt = $false; break } }
            if (-not $passt) { continue }
            $kat = if ([string]::IsNullOrWhiteSpace($b.kategorie)) { 'Ohne Kategorie' } else { [string]$b.kategorie }
            if (-not $gruppen.ContainsKey($kat)) {
                $g = New-Object System.Windows.Forms.ListViewGroup($kat)
                $gruppen[$kat] = $g; [void]$liste.Groups.Add($g)
            }
            $e = New-Object System.Windows.Forms.ListViewItem([string]$b.name)
            [void]$e.SubItems.Add([string]$b.beschreibung)
            $e.Tag = $b; $e.Group = $gruppen[$kat]
            [void]$liste.Items.Add($e)
        }
        $liste.EndUpdate()
        if ($liste.Items.Count -gt 0) { $liste.Items[0].Selected = $true }
    }.GetNewClosure()

    $nimm = {
        $b = $null
        if ($liste.SelectedItems.Count -gt 0) { $b = $liste.SelectedItems[0].Tag }
        elseif ($liste.Items.Count -gt 0)     { $b = $liste.Items[0].Tag }
        if ($null -eq $b) { return }
        $global:BausteinwahlErgebnis = $b
        $fenster.Close()
    }.GetNewClosure()

    $suchfeld.Add_TextChanged($fuelle)
    $suchfeld.Add_KeyDown({
        param($s, $e)
        if ($e.KeyCode -eq 'Return') { & $nimm; $e.Handled = $true; $e.SuppressKeyPress = $true }
        elseif ($e.KeyCode -eq 'Down' -and $liste.Items.Count -gt 0) {
            [void]$liste.Focus(); if ($liste.SelectedIndices.Count -eq 0) { $liste.Items[0].Selected = $true }
            $e.Handled = $true; $e.SuppressKeyPress = $true
        } elseif ($e.KeyCode -eq 'Escape') { $fenster.Close() }
    }.GetNewClosure())
    $liste.Add_DoubleClick($nimm)
    $liste.Add_KeyDown({
        param($s, $e)
        if ($e.KeyCode -eq 'Return') { & $nimm; $e.Handled = $true; $e.SuppressKeyPress = $true }
    }.GetNewClosure())
    $knopfOk.Add_Click($nimm)
    $knopfAus.Add_Click({ $global:BausteinwahlErgebnis = $null; $fenster.Close() }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 10)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 10)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({
        & $fuelle; & $ordne
        [DocKit.Windows]::Platzhaltertext($suchfeld.Handle, 'Tippen zum Suchen')
        [void]$suchfeld.Focus()
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:BausteinwahlErgebnis
}

<#
    Der vollständige Weg einer Vorlage: Kopie benennen, anlegen und auf Wunsch
    gleich einen Textbaustein hineinschreiben.
#>
function Benutze-Vorlage {
    param($Vorlage, $Baustein = $null, $Eintraege = $null, [string]$VorschlagName = '', [string]$Beschriftung = '')

    if (-not (Test-Path -LiteralPath $Vorlage.pfad)) { Vorlage-Fehlt-Meldung $Vorlage; return }

    <#
        Schritt 1: Wohin die Kopie kommt.

        Zuerst wird geschaut, welcher Ordner beim Drücken der Tastenkombination im
        Explorer offen war — dann landet die Kopie genau dort, und es ist nur noch
        der Name zu tippen. Nur wenn kein Ordnerfenster im Vordergrund stand, kommt
        der gewohnte Speichern-Dialog.

        $VorschlagName und $Beschriftung kommen von einer Kombination: Dort heißt
        die Datei wie die Kombination, nicht wie die zugrunde liegende Vorlage.
    #>
    $endung = [System.IO.Path]::GetExtension([string]$Vorlage.pfad)
    $vorschlag = if ($VorschlagName) { $VorschlagName + $endung } else { [System.IO.Path]::GetFileName([string]$Vorlage.pfad) }
    $anzeigeName = if ($Beschriftung) { $Beschriftung } else { [string]$Vorlage.name }
    $ordner = Hole-Explorer-Ordner $global:Zielfenster
    $ziel = ''

    if ($ordner) {
        $ziel = Frage-Dateiname -Ordner $ordner -Vorschlag $vorschlag -Endung $endung -Titel "»$anzeigeName« hier ablegen"
    } else {
        $d = New-Object System.Windows.Forms.SaveFileDialog
        $d.Title = "Kopie von »$anzeigeName« anlegen"
        $d.Filter = "Vorlagendatei (*$endung)|*$endung|Alle Dateien (*.*)|*.*"
        if ($endung) { $d.DefaultExt = $endung.TrimStart('.'); $d.AddExtension = $true }
        $d.FileName = $vorschlag
        $d.OverwritePrompt = $true
        if ($global:Einstellungen.letzter_zielordner -and (Test-Path -LiteralPath $global:Einstellungen.letzter_zielordner)) {
            $d.InitialDirectory = [string]$global:Einstellungen.letzter_zielordner
        }
        if ($d.ShowDialog() -ne 'OK') { return }
        $ziel = $d.FileName
    }
    if ([string]::IsNullOrWhiteSpace($ziel)) { return }

    try { Copy-Item -LiteralPath $Vorlage.pfad -Destination $ziel -Force }
    catch {
        Zeige-Meldung "Die Kopie ließ sich nicht anlegen:`r`n`r`n$($_.Exception.Message)" 'Kopieren fehlgeschlagen' 'Error'
        return
    }
    $global:Einstellungen.letzter_zielordner = Split-Path -Parent $ziel
    Speichere-Einstellungen

    Fuelle-Vorlagenkopie -Zieldatei $ziel -Vorlage $Vorlage -Baustein $Baustein -Eintraege $Eintraege
}

<#
    Schritt 2 und 3, gemeinsam genutzt: Die Kopie liegt bereits. Nun wird gefragt,
    ob ein Textbaustein hinein soll, und dieser gegebenenfalls hineingeschrieben.

    Wird sowohl vom Weg über die Schnellwahl als auch vom Herausziehen in den
    Explorer benutzt — der Ablauf ab hier ist derselbe.

    Kommt der Aufruf über eine einfache Vorlage, steht höchstens $Baustein fest
    (oder gar nichts — dann wird gefragt). Kommt er über eine Kombination mit
    mehreren verknüpften Bausteinen, steht $Eintraege fest: eine Liste aus
    Baustein und eigenem Ankerpunkt je Eintrag — dann entfällt jede Nachfrage,
    und jeder Baustein landet an seiner eigenen Stelle im Dokument.
#>
function Fuelle-Vorlagenkopie {
    param([string]$Zieldatei, $Vorlage, $Baustein = $null, $Eintraege = $null)

    if ($null -ne $Eintraege) {
        $zuSchreiben = New-Object System.Collections.ArrayList
        foreach ($e in @($Eintraege)) {
            if (@($e.Baustein.felder).Count -gt 0) {
                $erg = Zeige-Assistent -Baustein $e.Baustein
                if ($erg.Aktion -eq 'abbruch') {
                    if ($Vorlage.oeffnen_danach) { try { Start-Process -FilePath $Zieldatei } catch { } }
                    return
                }
            } else {
                $erg = Ersetze-Platzhalter-Rtf -Rtf (Hole-Baustein-Rtf $e.Baustein) -Werte @{}
            }
            [void]$zuSchreiben.Add([pscustomobject]@{
                Rtf = $erg.Rtf; Klartext = $erg.Text
                EinfuegenArt = $e.EinfuegenArt; EinfuegenMarke = $e.EinfuegenMarke
            })
        }
        $ergebnis = Schreibe-Bausteine-In-Dokument -Zieldatei $Zieldatei -Vorlage $Vorlage -Eintraege $zuSchreiben
        if ($ergebnis.Fehler) {
            Zeige-Meldung $ergebnis.Fehler 'Hinweis' 'Warning'
            if ($Vorlage.oeffnen_danach -and -not $ergebnis.Offen) { try { Start-Process -FilePath $Zieldatei } catch { } }
        }
        return
    }

    if ($null -eq $Baustein -and [string]$Vorlage.einfuegen_art -ne 'keine' -and @($global:Bausteine).Count -gt 0) {
        $frage = "Die Kopie ist angelegt:`r`n$([System.IO.Path]::GetFileName($Zieldatei))`r`n`r`n" +
                 'Soll gleich ein Textbaustein hineingeschrieben werden?'
        if (Frage-Ja-Nein $frage 'Textbaustein einfügen') { $Baustein = Waehle-Baustein }
    }

    if ($null -eq $Baustein) {
        if ($Vorlage.oeffnen_danach) { try { Start-Process -FilePath $Zieldatei } catch { } }
        return
    }

    if (@($Baustein.felder).Count -gt 0) {
        $erg = Zeige-Assistent -Baustein $Baustein
        if ($erg.Aktion -eq 'abbruch') {
            if ($Vorlage.oeffnen_danach) { try { Start-Process -FilePath $Zieldatei } catch { } }
            return
        }
    } else {
        $erg = Ersetze-Platzhalter-Rtf -Rtf (Hole-Baustein-Rtf $Baustein) -Werte @{}
    }

    $eintrag = [pscustomobject]@{
        Rtf = $erg.Rtf; Klartext = $erg.Text
        EinfuegenArt = $Vorlage.einfuegen_art; EinfuegenMarke = $Vorlage.einfuegen_marke
    }
    $ergebnis = Schreibe-Bausteine-In-Dokument -Zieldatei $Zieldatei -Vorlage $Vorlage -Eintraege @($eintrag)
    if ($ergebnis.Fehler) {
        Zeige-Meldung $ergebnis.Fehler 'Hinweis' 'Warning'
        if ($Vorlage.oeffnen_danach -and -not $ergebnis.Offen) { try { Start-Process -FilePath $Zieldatei } catch { } }
    }
}

<#
    Eine Vorlage aus dem Werkzeug in einen Explorer-Ordner ziehen.

    Der Ablauf: Windows übergibt die Datei beim Loslassen an den Explorer, der sie
    kopiert. Anschließend wird ermittelt, über welchem Fenster die Maus losgelassen
    wurde — daraus ergibt sich der Zielordner. Dort wird die eben entstandene Kopie
    gesucht, auf Wunsch umbenannt und mit einem Textbaustein gefüllt.
#>
function Ziehe-Vorlage-Heraus {
    param($Steuerelement, $Vorlage, $Baustein = $null, $Eintraege = $null, [string]$VorschlagName = '', [string]$Beschriftung = '')

    if (-not (Test-Path -LiteralPath $Vorlage.pfad)) { Vorlage-Fehlt-Meldung $Vorlage; return }

    $daten = New-Object System.Windows.Forms.DataObject
    $daten.SetFileDropList([System.Collections.Specialized.StringCollection]::new())
    $sammlung = New-Object System.Collections.Specialized.StringCollection
    [void]$sammlung.Add([string]$Vorlage.pfad)
    $daten.SetFileDropList($sammlung)

    $vorher = (Get-Date).AddSeconds(-2)
    $wirkung = $Steuerelement.DoDragDrop($daten, [System.Windows.Forms.DragDropEffects]::Copy)
    if ($wirkung -ne [System.Windows.Forms.DragDropEffects]::Copy) { return }

    # Wo wurde losgelassen?
    $zeiger = [System.Windows.Forms.Cursor]::Position
    $fenster = [DocKit.Windows]::FensterUnterPunkt($zeiger.X, $zeiger.Y)
    $ordner = Hole-Explorer-Ordner $fenster
    if (-not $ordner) { return }        # nicht im Explorer gelandet — Windows hat schon kopiert

    # Die eben entstandene Kopie finden. Der Explorer hängt bei Namensgleichheit
    # ein " (2)" an, deshalb wird nach dem Muster und der Uhrzeit gesucht.
    $endung = [System.IO.Path]::GetExtension([string]$Vorlage.pfad)
    $basis  = [System.IO.Path]::GetFileNameWithoutExtension([string]$Vorlage.pfad)
    $kopie = Get-ChildItem -LiteralPath $ordner -File -Filter "$basis*$endung" -ErrorAction SilentlyContinue |
             Where-Object { $_.LastWriteTime -ge $vorher -or $_.CreationTime -ge $vorher } |
             Sort-Object CreationTime -Descending | Select-Object -First 1
    if ($null -eq $kopie) { return }

    # Namen erfragen und gegebenenfalls umbenennen. Bei einer Kombination heißt
    # der Vorschlag wie die Kombination, nicht wie die zugrunde liegende Vorlage.
    $vorschlag = if ($VorschlagName) { $VorschlagName + $endung } else { $kopie.Name }
    $anzeigeName = if ($Beschriftung) { $Beschriftung } else { [string]$Vorlage.name }
    $ziel = Frage-Dateiname -Ordner $ordner -Vorschlag $vorschlag -Endung $endung -Titel "»$anzeigeName« ablegen"
    if ([string]::IsNullOrWhiteSpace($ziel)) { return }
    if ($ziel -ne $kopie.FullName) {
        try { Move-Item -LiteralPath $kopie.FullName -Destination $ziel -Force }
        catch {
            Zeige-Meldung "Die Datei ließ sich nicht umbenennen:`r`n`r`n$($_.Exception.Message)" 'Umbenennen fehlgeschlagen' 'Warning'
            $ziel = $kopie.FullName
        }
    }

    $global:Einstellungen.letzter_zielordner = $ordner
    Speichere-Einstellungen
    Fuelle-Vorlagenkopie -Zieldatei $ziel -Vorlage $Vorlage -Baustein $Baustein -Eintraege $Eintraege
}

<#
    Löst eine Kombination in ihre Bestandteile auf: die verknüpfte Vorlage und
    jeden verknüpften Baustein mit seinem eigenen Ankerpunkt. Fehlt die Vorlage,
    fehlt einer der verknüpften Bausteine, oder ist die Liste leer, gibt es eine
    verständliche Meldung statt eines stillen Abbruchs oder eines falsch
    platzierten Textes.
#>
function Pruefe-Kombination {
    param($Kombination)
    $vorlage = @($global:Vorlagen) | Where-Object { $_ -and $_.id -eq $Kombination.vorlage_id } | Select-Object -First 1
    if ($null -eq $vorlage) {
        Zeige-Meldung ("Die verknüpfte Vorlage ist in »$($Kombination.name)« nicht mehr vorhanden — vermutlich gelöscht.`r`n`r`n" +
            'Über Bausteine verwalten → Kombinationen lässt sich die Verknüpfung erneuern.') 'Kombination unvollständig' 'Warning'
        return $null
    }
    if (@($Kombination.bausteine).Count -eq 0) {
        Zeige-Meldung ("Die Kombination »$($Kombination.name)« hat keinen verknüpften Baustein mehr.`r`n`r`n" +
            'Über Bausteine verwalten → Kombinationen lässt sich mindestens einer hinzufügen.') 'Kombination unvollständig' 'Warning'
        return $null
    }

    $eintraege = New-Object System.Collections.ArrayList
    foreach ($b in @($Kombination.bausteine)) {
        $baustein = @($global:Bausteine) | Where-Object { $_ -and $_.id -eq $b.baustein_id } | Select-Object -First 1
        if ($null -eq $baustein) {
            Zeige-Meldung ("Ein verknüpfter Baustein ist in »$($Kombination.name)« nicht mehr vorhanden — vermutlich gelöscht.`r`n`r`n" +
                'Über Bausteine verwalten → Kombinationen lässt sich die Verknüpfung erneuern.') 'Kombination unvollständig' 'Warning'
            return $null
        }
        [void]$eintraege.Add([pscustomobject]@{
            Baustein = $baustein; EinfuegenArt = [string]$b.einfuegen_art; EinfuegenMarke = [string]$b.einfuegen_marke
        })
    }
    return [pscustomobject]@{ Vorlage = $vorlage; Eintraege = $eintraege }
}

<#
    Eine Kombination benutzen: Kopie der verknüpften Vorlage anlegen und ohne
    weitere Nachfrage direkt mit den verknüpften Bausteinen füllen — jeden an
    seinem eigenen Ankerpunkt.
#>
function Benutze-Kombination {
    param($Kombination)
    $teile = Pruefe-Kombination $Kombination
    if ($null -eq $teile) { return }
    Benutze-Vorlage -Vorlage $teile.Vorlage -Eintraege $teile.Eintraege -VorschlagName $Kombination.name -Beschriftung $Kombination.name
}

# Dieselbe Kombination, aber aus dem Fenster in einen Explorer-Ordner gezogen.
function Ziehe-Kombination-Heraus {
    param($Steuerelement, $Kombination)
    $teile = Pruefe-Kombination $Kombination
    if ($null -eq $teile) { return }
    Ziehe-Vorlage-Heraus -Steuerelement $Steuerelement -Vorlage $teile.Vorlage -Eintraege $teile.Eintraege -VorschlagName $Kombination.name -Beschriftung $Kombination.name
}

# =====================================================================
#  7. SCHNELLWAHL — das Fenster hinter der Tastenkombination
# =====================================================================

<#
    Ein Suchfeld und eine Liste. Tippen filtert, Pfeiltasten wählen, Enter fügt ein.
    Das Fenster merkt sich nichts und ändert nichts — es entscheidet nur, welcher
    Baustein als Nächstes drankommt.
#>
function Zeige-Schnellwahl {

    if ($global:SchnellwahlOffen) { return }
    $global:SchnellwahlOffen = $true
    $global:SchnellwahlAuswahl = $null
    # Welche Überschriften zugeklappt sind, bleibt über die ganze Sitzung erhalten.
    if ($null -eq $global:SchnellwahlZu) {
        $global:SchnellwahlZu = New-Object 'System.Collections.Generic.HashSet[string]'
    }

    try {
        $fenster = Neues-Fenster -Titel 'Textbaustein auswählen' -Breite 860 -Hoehe 560
        $fenster.MinimumSize = New-Object System.Drawing.Size(640, 420)
        $fenster.TopMost = $true

        # --- Suchfeld ---
        $suchbereich = New-Object System.Windows.Forms.Panel
        $suchbereich.Dock = 'Top'
        $suchbereich.Height = 66
        $suchbereich.BackColor = $global:Farbe.Flaeche
        # Rechts bleibt Platz für das Zahnrad am Fensterrand.
        $suchbereich.Padding = New-Object System.Windows.Forms.Padding(14, 12, 58, 10)

        $suchfeld = New-Object System.Windows.Forms.TextBox
        $suchfeld.Dock = 'Fill'
        $suchfeld.Font = $global:SchriftSuche
        $suchfeld.BorderStyle = 'FixedSingle'
        $suchbereich.Controls.Add($suchfeld)

        $suchTrenner = New-Object System.Windows.Forms.Panel
        $suchTrenner.Dock = 'Bottom'
        $suchTrenner.Height = 1
        $suchTrenner.BackColor = $global:Farbe.Rahmen
        $suchbereich.Controls.Add($suchTrenner)

        # --- Ergebnisliste ---
        $liste = New-Object System.Windows.Forms.ListView
        $liste.Dock = 'Fill'
        $liste.View = 'Details'
        $liste.FullRowSelect = $true
        $liste.MultiSelect = $false
        $liste.HideSelection = $false
        $liste.HeaderStyle = 'Nonclickable'
        $liste.BorderStyle = 'None'
        $liste.BackColor = $global:Farbe.Flaeche
        $liste.ShowGroups = $false      # Überschriften sind eigene Zeilen, siehe unten
        $liste.SmallImageList = Erzeuge-Listensymbole
        [void]$liste.Columns.Add('Eintrag', 300)
        [void]$liste.Columns.Add('Kürzel / Art', 90)
        [void]$liste.Columns.Add('Wofür', 420)

        # Reiter oben: Bausteine und Vorlagen lassen sich trennen, ohne dass die
        # gemeinsame Suche verloren geht — "Alles" bleibt die Voreinstellung.
        $reiter = New-Object System.Windows.Forms.TabControl
        $reiter.Dock = 'Fill'
        $reiter.Padding = New-Object System.Drawing.Point(14, 5)
        $seiteAlles         = New-Object System.Windows.Forms.TabPage
        $seiteBausteine     = New-Object System.Windows.Forms.TabPage
        $seiteVorlagen      = New-Object System.Windows.Forms.TabPage
        $seiteKombinationen = New-Object System.Windows.Forms.TabPage
        $seiteAlles.Text         = '  Alles  '
        $seiteBausteine.Text     = '  Textbausteine  '
        $seiteVorlagen.Text      = '  Vorlagen  '
        $seiteKombinationen.Text = '  Kombinationen  '
        foreach ($s in @($seiteAlles, $seiteBausteine, $seiteVorlagen, $seiteKombinationen)) {
            $s.BackColor = $global:Farbe.Flaeche
            [void]$reiter.TabPages.Add($s)
        }
        $seiteAlles.Controls.Add($liste)

        # --- Fußzeile ---
        $fuss = New-Object System.Windows.Forms.Panel
        $fuss.Dock = 'Bottom'
        $fuss.Height = 46
        $fuss.BackColor = $global:Farbe.Flaeche

        $fussTrenner = New-Object System.Windows.Forms.Panel
        $fussTrenner.Dock = 'Top'
        $fussTrenner.Height = 1
        $fussTrenner.BackColor = $global:Farbe.Rahmen
        $fuss.Controls.Add($fussTrenner)

        # Der Umschalter zwischen den Textbausteindateien. Er steht hier, weil das
        # Wechseln mitten im Schreiben schnell gehen muss: Fenster auf, Datei
        # wählen, Baustein wählen.
        $cbDatei = New-Object System.Windows.Forms.ComboBox
        $cbDatei.DropDownStyle = 'DropDownList'
        $cbDatei.Width = 210
        $cbDatei.Location = New-Object System.Drawing.Point(16, 11)
        $fuss.Controls.Add($cbDatei)

        $status = Neue-Beschriftung -Text '' -Klein
        $status.Location = New-Object System.Drawing.Point(236, 15)
        $fuss.Controls.Add($status)

        $tastenhilfe = Neue-Beschriftung -Text '↑ ↓  auswählen     ⏎  einfügen     Esc  schließen' -Klein
        $tastenhilfe.Anchor = 'Top,Right'
        $fuss.Controls.Add($tastenhilfe)

        $knopfVerwalten = Neuer-Knopf -Text 'Bausteine verwalten…' -Breite 170 -Hoehe 28
        $knopfVerwalten.Anchor = 'Top,Right'
        $knopfVerwalten.Font = $global:SchriftKlein
        $fuss.Controls.Add($knopfVerwalten)

        <#
            Vorschau nur auf ausdrücklichen Klick — nicht mehr automatisch beim
            bloßen Anklicken einer Vorlagenzeile. Der Knopf ist nur aktiv, wenn
            gerade eine Vorlage ausgewählt ist.
        #>
        $knopfVorschauUebersicht = Neuer-Knopf -Text 'Vorschau' -Breite 100 -Hoehe 28
        $knopfVorschauUebersicht.Anchor = 'Top,Right'
        $knopfVorschauUebersicht.Font = $global:SchriftKlein
        $knopfVorschauUebersicht.Enabled = $false
        $fuss.Controls.Add($knopfVorschauUebersicht)

        # Zahnrad: oben rechts am Fensterrand, springt jederzeit in die Einstellungen.
        $knopfZahnrad = Neuer-Knopf -Text ([string][char]0x2699) -Breite 34 -Hoehe 30
        $knopfZahnrad.Font = New-Object System.Drawing.Font('Segoe UI Symbol', 13)
        $knopfZahnrad.Anchor = 'Top,Right'
        $hilfeZahnrad = New-Object System.Windows.Forms.ToolTip
        $hilfeZahnrad.SetToolTip($knopfZahnrad, 'Einstellungen öffnen')
        $suchbereich.Controls.Add($knopfZahnrad)
        $knopfZahnrad.BringToFront()

        # Das Zahnrad klebt am rechten Rand des Suchbereichs.
        $setzeZahnrad = {
            $knopfZahnrad.Location = New-Object System.Drawing.Point(
                ($suchbereich.Width - $knopfZahnrad.Width - 12), 12)
        }.GetNewClosure()
        $suchbereich.Add_Resize($setzeZahnrad)

        $fenster.Controls.Add($reiter)
        $fenster.Controls.Add($fuss)
        $fenster.Controls.Add($suchbereich)

        # --- Liste füllen und filtern ---
        $fuelle = {
            $begriffe = @(($suchfeld.Text.Trim()) -split '\s+' | Where-Object { $_ })
            $liste.BeginUpdate()
            $liste.Items.Clear()
            $gruppen = @{}
            $reihenfolge = New-Object System.Collections.ArrayList

            # Bausteine und Vorlagen stehen in einer Liste, damit ein einziges
            # Suchwort beides findet. Die Vorlagen bilden dabei eine eigene Gruppe
            # und stehen unten.
            $alle = New-Object System.Collections.ArrayList
            foreach ($b in @($global:Bausteine)) {
                $kat = if ([string]::IsNullOrWhiteSpace($b.kategorie)) { 'Ohne Kategorie' } else { [string]$b.kategorie }
                [void]$alle.Add([pscustomobject]@{
                    Art = 'baustein'; Objekt = $b; Rang = 0
                    Name = [string]$b.name; Kategorie = $kat
                    Spalte2 = [string]$b.kuerzel; Spalte3 = [string]$b.beschreibung
                    Farbe = $(if (@($b.felder).Count -gt 0) { $global:Farbe.Akzent } else { $global:Farbe.Text })
                })
            }
            foreach ($v in @($global:Vorlagen)) {
                $fehlt = -not (Test-Path -LiteralPath ([string]$v.pfad))
                $wofuer = if ($fehlt) { 'nicht erreichbar — ' + $v.pfad }
                          elseif ($v.beschreibung) { [string]$v.beschreibung }
                          else { [string]$v.pfad }
                [void]$alle.Add([pscustomobject]@{
                    Art = 'vorlage'; Objekt = $v; Rang = 1
                    Name = [string]$v.name
                    Kategorie = $(if ($v.kategorie) { [string]$v.kategorie } else { 'Vorlagen' })
                    Spalte2 = ([System.IO.Path]::GetExtension([string]$v.pfad)).TrimStart('.')
                    Spalte3 = $wofuer
                    Farbe = $(if ($fehlt) { $global:Farbe.Warnung } else { $global:Farbe.Vorlage })
                })
            }
            <#
                Eine Kombination zeigt den Namen der verknüpften Vorlage und des
                verknüpften Bausteins zusammen — so ist auf einen Blick klar, was
                beim Ziehen entsteht, ohne dass man erst nachsehen muss.
            #>
            foreach ($k in @($global:Kombinationen)) {
                $kVorlage = @($global:Vorlagen) | Where-Object { $_ -and $_.id -eq $k.vorlage_id } | Select-Object -First 1
                $namen = Kombination-Bausteinnamen $k
                $fehlt = ($null -eq $kVorlage) -or (-not $namen.Vollstaendig) -or (-not (Test-Path -LiteralPath ([string]$kVorlage.pfad)))
                $wofuer = if ($null -eq $kVorlage -or -not $namen.Vollstaendig) { 'unvollständig — Vorlage oder Baustein fehlt' }
                          elseif (-not (Test-Path -LiteralPath ([string]$kVorlage.pfad))) { 'Vorlagendatei nicht erreichbar — ' + $kVorlage.pfad }
                          elseif ($k.beschreibung) { [string]$k.beschreibung }
                          else { "$($kVorlage.name)  +  $($namen.Text)" }
                [void]$alle.Add([pscustomobject]@{
                    Art = 'kombination'; Objekt = $k; Rang = 2
                    Name = [string]$k.name
                    Kategorie = $(if ($k.kategorie) { [string]$k.kategorie } else { 'Allgemein' })
                    Spalte2 = 'Kombi'
                    Spalte3 = $wofuer
                    Farbe = $(if ($fehlt) { $global:Farbe.Warnung } else { $global:Farbe.Kombination })
                })
            }

            # Der gewählte Reiter blendet die jeweils anderen Arten aus.
            $nurArt = switch ($reiter.SelectedIndex) { 1 { 'baustein' } 2 { 'vorlage' } 3 { 'kombination' } default { '' } }

            foreach ($e in @($alle | Sort-Object Rang, Kategorie, Name)) {
                if ($nurArt -and $e.Art -ne $nurArt) { continue }
                $heuhaufen = "$($e.Name) $($e.Kategorie) $($e.Spalte2) $($e.Spalte3)"
                $passt = $true
                foreach ($t in $begriffe) { if ($heuhaufen -notlike "*$t*") { $passt = $false; break } }
                if (-not $passt) { continue }

                <#
                    Nur im Reiter "Alles" muss die Überschrift die Art nennen —
                    dort stehen alle drei durcheinander. In den eigenen Reitern
                    ist die Art schon durch den Reiter klar; dann genügt die
                    Kategorie. Die Art steckt außerdem im Symbol der Zeile.
                #>
                $ueberschrift = if ($nurArt) {
                    [string]$e.Kategorie
                } else {
                    switch ($e.Art) {
                        'vorlage'     { "$($e.Kategorie)   ·   Vorlagen" }
                        'kombination' { "$($e.Kategorie)   ·   Kombinationen" }
                        default       { [string]$e.Kategorie }
                    }
                }
                <#
                    Die Überschrift ist eine eigene, anklickbare Zeile — keine
                    Windows-Gruppe. Deren Klapppfeile lassen sich zwar anzeigen,
                    reagieren unter WinForms aber nicht auf Klicks; nachgemessen.
                    So bleibt das Verhalten in der Hand des Programms.
                #>
                if (-not $gruppen.ContainsKey($ueberschrift)) {
                    $gruppen[$ueberschrift] = New-Object System.Collections.ArrayList
                    [void]$reihenfolge.Add($ueberschrift)
                }
                [void]$gruppen[$ueberschrift].Add($e)
            }

            foreach ($ueberschrift in $reihenfolge) {
                $eintraege = $gruppen[$ueberschrift]
                $zu = $global:SchnellwahlZu.Contains($ueberschrift)
                $pfeil = if ($zu) { [char]0x25B8 } else { [char]0x25BE }   # ▸ bzw. ▾

                $kopfzeile = New-Object System.Windows.Forms.ListViewItem("$pfeil  $ueberschrift   ($($eintraege.Count))")
                [void]$kopfzeile.SubItems.Add('')
                [void]$kopfzeile.SubItems.Add('')
                $kopfzeile.Font = $global:SchriftFett
                $kopfzeile.BackColor = $global:Farbe.Hintergrund
                $kopfzeile.ForeColor = $global:Farbe.Grau
                $kopfzeile.Tag = [pscustomobject]@{ Art = 'ueberschrift'; Schluessel = $ueberschrift; ArtKat = [string]$eintraege[0].Art }
                [void]$liste.Items.Add($kopfzeile)

                if ($zu) { continue }
                foreach ($e in $eintraege) {
                    $eintrag = New-Object System.Windows.Forms.ListViewItem('     ' + $e.Name)
                    [void]$eintrag.SubItems.Add($e.Spalte2)
                    [void]$eintrag.SubItems.Add($e.Spalte3)
                    $eintrag.ForeColor = $e.Farbe
                    $eintrag.ImageIndex = $(switch ($e.Art) { 'vorlage' { 1 } 'kombination' { 2 } default { 0 } })
                    $eintrag.Tag = $e
                    [void]$liste.Items.Add($eintrag)
                }
            }
            $liste.EndUpdate()
            # Die erste Zeile, die keine Überschrift ist, vorauswählen
            foreach ($it in $liste.Items) {
                if ($it.Tag -and $it.Tag.Art -ne 'ueberschrift') { $it.Selected = $true; break }
            }
            # Überschriftenzeilen sind Beiwerk und zählen nicht mit.
            $sichtbar = @($liste.Items | Where-Object { $_.Tag -and $_.Tag.Art -ne 'ueberschrift' }).Count
            $gesamt = @($global:Bausteine).Count + @($global:Vorlagen).Count + @($global:Kombinationen).Count
            $status.Text = if ($sichtbar -eq $gesamt) {
                "$(@($global:Bausteine).Count) Bausteine · $(@($global:Vorlagen).Count) Vorlagen · $(@($global:Kombinationen).Count) Kombinationen"
            } else {
                "$sichtbar von $gesamt angezeigt"
            }
        }.GetNewClosure()

        <#
            Der Vorschau-Knopf ist nur aktiv, wenn die Auswahl gerade eine
            Vorlage ist — nicht bei einem Baustein, einer Kombination oder
            einer Überschrift. Läuft bei jeder Änderung der Auswahl mit, auch
            nach einem Neuaufbau der Liste (dort wird ja auch ausgewählt).
        #>
        $liste.Add_SelectedIndexChanged({
            $ausgewaehlt = $null
            if ($liste.SelectedItems.Count -gt 0) { $ausgewaehlt = $liste.SelectedItems[0].Tag }
            $knopfVorschauUebersicht.Enabled = ($null -ne $ausgewaehlt -and $ausgewaehlt.Art -eq 'vorlage')
        }.GetNewClosure())

        <#
            Die Übersicht steht auf TopMost, damit sie beim Aufruf per
            Tastenkombination nicht hinter dem gerade aktiven Fenster
            verschwindet. Das Vorschaufenster ist das nicht — bliebe die
            Übersicht während der Vorschau TopMost, läge sie davor und die
            Vorschau ließe sich nicht in den Vordergrund holen.
        #>
        $knopfVorschauUebersicht.Add_Click({
            if ($liste.SelectedItems.Count -eq 0) { return }
            $eintrag = $liste.SelectedItems[0].Tag
            if ($null -eq $eintrag -or $eintrag.Art -ne 'vorlage') { return }
            $fenster.TopMost = $false
            try { Zeige-Vorlage-Vorschau $eintrag.Objekt } finally { $fenster.TopMost = $true }
        }.GetNewClosure())

        # Beim Reiterwechsel wandert die Liste in die gewählte Seite und wird neu gefüllt.
        $reiter.Add_SelectedIndexChanged({
            $seite = $reiter.SelectedTab
            if ($seite -and -not $seite.Controls.Contains($liste)) { $seite.Controls.Add($liste) }
            & $fuelle
            [void]$suchfeld.Focus()
        }.GetNewClosure())

        # Klappt eine Überschrift auf oder zu und baut die Liste neu auf.
        $klappe = {
            param([string]$Schluessel)
            if ($global:SchnellwahlZu.Contains($Schluessel)) { [void]$global:SchnellwahlZu.Remove($Schluessel) }
            else { [void]$global:SchnellwahlZu.Add($Schluessel) }
            & $fuelle
        }.GetNewClosure()

        $waehle = {
            $e = $null
            if ($liste.SelectedItems.Count -gt 0) { $e = $liste.SelectedItems[0].Tag }
            if ($null -eq $e) { return }
            if ($e.Art -eq 'ueberschrift') { & $klappe $e.Schluessel; return }
            $global:SchnellwahlAuswahl = $e
            $fenster.Close()
        }.GetNewClosure()

        <#
            Kategorien lassen sich hier bearbeiten: Rechtsklick auf eine Überschrift
            bietet Umbenennen und Auflösen an. Gelöscht wird dabei nie ein Baustein —
            beim Auflösen wandern sie nach "Ohne Kategorie".
        #>
        $speichereStill = {
            if ($global:NurLesen) {
                Zeige-Meldung ("Diese Textbausteindatei ist schreibgeschützt:`r`n`r`n$($global:BausteinDatei)") 'Nur lesen' 'Warning'
                return $false
            }
            try { Speichere-Bausteine; return $true }
            catch {
                Zeige-Meldung "Das Speichern ist fehlgeschlagen:`r`n`r`n$($_.Exception.Message)" 'Nicht gespeichert' 'Error'
                return $false
            }
        }.GetNewClosure()

        # Aus der Überschrift den reinen Kategorienamen holen
        $katAusSchluessel = {
            param([string]$Schluessel)
            $k = $Schluessel
            $i = $k.IndexOf('   ·   ')
            if ($i -gt 0) { $k = $k.Substring(0, $i) }
            return $k.Trim()
        }.GetNewClosure()

        # $ArtKat: 'baustein', 'vorlage' oder 'kombination' — welche Liste betroffen ist.
        $mengeFuerArt = {
            param([string]$ArtKat)
            switch ($ArtKat) {
                'vorlage'     { return , @($global:Vorlagen) }
                'kombination' { return , @($global:Kombinationen) }
                default       { return , @($global:Bausteine) }
            }
        }.GetNewClosure()

        $benenneKategorie = {
            param([string]$Schluessel, [string]$ArtKat)
            $alt = & $katAusSchluessel $Schluessel
            $neu = Frage-Nach-Text -Titel 'Kategorie umbenennen' -Beschriftung "Neuer Name für »$alt«" -Vorgabe $alt
            if ([string]::IsNullOrWhiteSpace($neu) -or $neu -eq $alt) { return }
            $menge = & $mengeFuerArt $ArtKat
            $anzahl = 0
            foreach ($x in $menge) {
                if ($null -eq $x) { continue }
                $k = if ([string]::IsNullOrWhiteSpace($x.kategorie)) { 'Ohne Kategorie' } else { [string]$x.kategorie }
                if ($k -eq $alt) { $x.kategorie = $neu; $anzahl++ }
            }
            if ($anzahl -gt 0 -and (& $speichereStill)) {
                [void]$global:SchnellwahlZu.Remove($Schluessel)
                & $fuelle
            }
        }.GetNewClosure()

        $loeseKategorieAuf = {
            param([string]$Schluessel, [string]$ArtKat)
            $alt = & $katAusSchluessel $Schluessel
            $menge = & $mengeFuerArt $ArtKat
            $betroffen = @($menge | Where-Object { $_ -and (($(if ([string]::IsNullOrWhiteSpace($_.kategorie)) { 'Ohne Kategorie' } else { [string]$_.kategorie })) -eq $alt) })
            if ($betroffen.Count -eq 0) { return }
            $frage = "Die Kategorie »$alt« auflösen?`r`n`r`n" +
                     "$($betroffen.Count) Eintrag/Einträge wandern nach »Ohne Kategorie«.`r`n" +
                     'Es wird nichts gelöscht.'
            if (-not (Frage-Ja-Nein $frage 'Kategorie auflösen')) { return }
            foreach ($x in $betroffen) { $x.kategorie = 'Ohne Kategorie' }
            if (& $speichereStill) {
                [void]$global:SchnellwahlZu.Remove($Schluessel)
                & $fuelle
            }
        }.GetNewClosure()

        <#
            ACHTUNG: Das Menü wird hier EINMAL gebaut, nicht erst beim Rechtsklick.
            Ein .GetNewClosure() innerhalb eines anderen Closures erbt dessen
            Variablen nicht — würden die Klick-Handler also im MouseUp entstehen,
            wären $benenneKategorie und $loeseKategorieAuf beim Klick leer.
            Welche Kategorie gemeint ist, merkt sich das Menü in seinem Tag.
        #>
        $katMenue = New-Object System.Windows.Forms.ContextMenuStrip
        $mWeitergeben = $katMenue.Items.Add('Weitergeben …')
        $mWeitergeben.Add_Click({
            $ziel = $katMenue.Tag
            if ($ziel -and $ziel.Baustein) {
                $fenster.TopMost = $false
                try { Zeige-Weitergabe @($ziel.Baustein) } finally { $fenster.TopMost = $true }
            }
        }.GetNewClosure())
        $mUmbenennen = $katMenue.Items.Add('Kategorie umbenennen …')
        $mUmbenennen.Add_Click({
            $ziel = $katMenue.Tag
            if ($ziel) { & $benenneKategorie $ziel.Schluessel $ziel.ArtKat }
        }.GetNewClosure())
        $mAufloesen = $katMenue.Items.Add('Kategorie auflösen …')
        $mAufloesen.Add_Click({
            $ziel = $katMenue.Tag
            if ($ziel) { & $loeseKategorieAuf $ziel.Schluessel $ziel.ArtKat }
        }.GetNewClosure())

        <#
            Das Menü hängt fest an der Liste. Windows zeigt es beim Rechtsklick
            von selbst; kurz vorher fragen wir, worüber der Zeiger steht — und
            blenden ein, was dazu passt. Über leerer Fläche wird es abgesagt.
        #>
        $liste.ContextMenuStrip = $katMenue
        $katMenue.Add_Opening({
            param($absender, $e)
            $stelle = $liste.PointToClient([System.Windows.Forms.Cursor]::Position)
            $treffer = $liste.HitTest($stelle.X, $stelle.Y)
            if ($null -eq $treffer.Item -or $null -eq $treffer.Item.Tag) { $e.Cancel = $true; return }
            $art = [string]$treffer.Item.Tag.Art

            if ($art -eq 'ueberschrift') {
                $katMenue.Tag = [pscustomobject]@{
                    Schluessel = [string]$treffer.Item.Tag.Schluessel
                    ArtKat     = [string]$treffer.Item.Tag.ArtKat
                    Baustein   = $null
                }
            } elseif ($art -eq 'baustein') {
                $katMenue.Tag = [pscustomobject]@{
                    Schluessel = ''
                    ArtKat     = ''
                    Baustein   = $treffer.Item.Tag.Objekt
                }
            } else {
                # Vorlagen und Kombinationen verweisen auf eine Datei bzw. auf
                # andere Einträge; die gibt man anders weiter.
                $e.Cancel = $true
                return
            }

            $istKopf = ($art -eq 'ueberschrift')
            $mWeitergeben.Visible = -not $istKopf
            $mUmbenennen.Visible  = $istKopf
            $mAufloesen.Visible   = $istKopf
        }.GetNewClosure())

        # Linksklick auf eine Überschrift klappt sie zu oder auf.
        $liste.Add_MouseDown({
            param($absender, $e)
            if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
            $treffer = $liste.HitTest($e.X, $e.Y)
            if ($null -eq $treffer.Item -or $null -eq $treffer.Item.Tag) { return }
            if ($treffer.Item.Tag.Art -ne 'ueberschrift') { return }
            & $klappe $treffer.Item.Tag.Schluessel
        }.GetNewClosure())

        # --- Dateiumschalter füllen und verdrahten ---
        $dateiSperre = @{ Aktiv = $false }

        $fuelleDateien = {
            $dateiSperre.Aktiv = $true
            $cbDatei.Items.Clear()
            foreach ($p in @($global:Einstellungen.zuletzt_verwendet)) {
                if ([string]::IsNullOrWhiteSpace($p)) { continue }
                $anzeige = Dateiname-Kurz $p
                if (-not (Test-Path -LiteralPath $p)) { $anzeige += '  (nicht erreichbar)' }
                [void]$cbDatei.Items.Add((New-Object DocKit.Option($anzeige, [string]$p)))
            }
            [void]$cbDatei.Items.Add((New-Object DocKit.Option('Andere Datei öffnen …', '')))
            [void]$cbDatei.Items.Add((New-Object DocKit.Option('Neue Datei anlegen …', '#neu')))
            for ($i = 0; $i -lt $cbDatei.Items.Count; $i++) {
                if ($cbDatei.Items[$i].Wert -eq $global:BausteinDatei) { $cbDatei.SelectedIndex = $i; break }
            }
            $dateiSperre.Aktiv = $false
        }.GetNewClosure()

        $cbDatei.Add_SelectedIndexChanged({
            if ($dateiSperre.Aktiv -or $null -eq $cbDatei.SelectedItem) { return }
            $pfad = [string]$cbDatei.SelectedItem.Wert
            if ($pfad -eq $global:BausteinDatei) { return }
            if ($pfad -eq '#neu') {
                # Neu anlegen: Speicherort erfragen, Datei mit Beispielen fuellen, oeffnen.
                $ziel = Frage-Bausteindatei-Neu
                if ($ziel) {
                    Erzeuge-Bausteindatei $ziel
                    [void](Oeffne-Bausteindatei $ziel)
                }
            } elseif ([string]::IsNullOrWhiteSpace($pfad)) {
                $neu = Frage-Bausteindatei-Oeffnen
                if ($neu) { [void](Oeffne-Bausteindatei $neu) }
            } else {
                [void](Oeffne-Bausteindatei $pfad)
            }
            & $fuelleDateien
            & $fuelle
            [void]$suchfeld.Focus()
        }.GetNewClosure())

        $suchfeld.Add_TextChanged($fuelle)

        $suchfeld.Add_KeyDown({
            param($absender, $e)
            switch ([string]$e.KeyCode) {
                'Down' {
                    if ($liste.Items.Count -gt 0) {
                        [void]$liste.Focus()
                        if ($liste.SelectedIndices.Count -eq 0) { $liste.Items[0].Selected = $true }
                        $liste.FocusedItem = $liste.SelectedItems[0]
                    }
                    $e.Handled = $true; $e.SuppressKeyPress = $true
                }
                'Return' { & $waehle; $e.Handled = $true; $e.SuppressKeyPress = $true }
                'Escape' { $fenster.Close() }
            }
        }.GetNewClosure())

        $liste.Add_KeyDown({
            param($absender, $e)
            if ($e.KeyCode -eq 'Return') { & $waehle; $e.Handled = $true; $e.SuppressKeyPress = $true }
            elseif ($e.KeyCode -eq 'Escape') { $fenster.Close() }
            elseif ($e.KeyCode -eq 'Back') {
                if ($suchfeld.Text.Length -gt 0) { $suchfeld.Text = $suchfeld.Text.Substring(0, $suchfeld.Text.Length - 1) }
                [void]$suchfeld.Focus(); $suchfeld.SelectionStart = $suchfeld.Text.Length
                $e.Handled = $true; $e.SuppressKeyPress = $true
            }
        }.GetNewClosure())

        # Wer in der Liste einfach weitertippt, landet automatisch wieder im Suchfeld.
        $liste.Add_KeyPress({
            param($absender, $e)
            if ([int][char]$e.KeyChar -ge 32) {
                $suchfeld.Text += [string]$e.KeyChar
                [void]$suchfeld.Focus()
                $suchfeld.SelectionStart = $suchfeld.Text.Length
                $e.Handled = $true
            }
        }.GetNewClosure())

        $liste.Add_DoubleClick($waehle)

        $liste.AllowDrop = $true

        <#
            Ziehen aus der Liste heraus. Ein Baustein trägt dabei zweierlei mit
            sich: das hauseigene Format für das Verschieben in eine andere
            Kategorie und zusätzlich eine fertige Weitergabedatei. Windows sucht
            sich aus, was am Ziel gebraucht wird — innerhalb des Fensters das
            eine, im Explorer oder in einem Mailfenster das andere.

            Eine Vorlage verweist auf eine Datei und geht deshalb ihren eigenen Weg.
        #>
        $liste.Add_ItemDrag({
            param($absender, $e)
            $eintrag = $e.Item.Tag
            if ($null -eq $eintrag -or $eintrag.Art -eq 'ueberschrift') { return }
            if ($eintrag.Art -eq 'baustein') {
                $daten = New-Object System.Windows.Forms.DataObject('DocKitBaustein', $eintrag.Objekt)
                # Die Weitergabedatei entsteht erst beim Ziehen und landet in %TEMP%.
                try {
                    $sammlung = New-Object System.Collections.Specialized.StringCollection
                    [void]$sammlung.Add((Erzeuge-Weitergabe-Temp @($eintrag.Objekt)))
                    $daten.SetFileDropList($sammlung)
                } catch { }   # ohne Datei bleibt wenigstens das Verschieben möglich
                $fenster.TopMost = $false      # sonst liegt die Übersicht über dem Ziel
                try {
                    [void]$liste.DoDragDrop($daten, ([System.Windows.Forms.DragDropEffects]::Move -bor [System.Windows.Forms.DragDropEffects]::Copy))
                } finally { $fenster.TopMost = $true }
                return
            }
            if ($eintrag.Art -eq 'vorlage') {
                $fenster.TopMost = $false          # sonst liegt die Übersicht über dem Explorer
                try { Ziehe-Vorlage-Heraus -Steuerelement $liste -Vorlage $eintrag.Objekt }
                finally { $fenster.TopMost = $true }
                & $fuelle
                return
            }
            if ($eintrag.Art -ne 'kombination') { return }
            $fenster.TopMost = $false
            try { Ziehe-Kombination-Heraus -Steuerelement $liste -Kombination $eintrag.Objekt }
            finally { $fenster.TopMost = $true }
            & $fuelle
        }.GetNewClosure())

        <#
            Fallenlassen im Fenster. Zweierlei wird angenommen: ein Baustein von
            hier — dann über einer Baustein-Überschrift, das verschiebt ihn —,
            und eine Weitergabedatei von außen, die zum Übernehmen führt.

            ACHTUNG: Erst auf das hauseigene Format prüfen, dann auf die Datei.
            Ein gezogener Baustein trägt beides mit sich (siehe oben). Andersherum
            gefragt hielte das Fenster den eigenen Baustein für eine fremde Datei
            und böte ihn zum Übernehmen an, statt ihn zu verschieben.
        #>
        $istWeitergabedatei = {
            param($Daten)
            if (-not $Daten.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { return $false }
            foreach ($f in @($Daten.GetData([System.Windows.Forms.DataFormats]::FileDrop))) {
                $endung = [System.IO.Path]::GetExtension([string]$f)
                if ($endung -eq $global:WeitergabeEndung -or $endung -eq $global:Dateiendung) { return $true }
            }
            return $false
        }.GetNewClosure()

        $liste.Add_DragEnter({
            param($absender, $e)
            if ($e.Data.GetDataPresent('DocKitBaustein')) { $e.Effect = 'Move' }
            elseif (& $istWeitergabedatei $e.Data) { $e.Effect = 'Copy' }
            else { $e.Effect = 'None' }
        }.GetNewClosure())
        $liste.Add_DragOver({
            param($absender, $e)
            if (-not $e.Data.GetDataPresent('DocKitBaustein')) {
                $e.Effect = if (& $istWeitergabedatei $e.Data) { 'Copy' } else { 'None' }
                return
            }
            $stelle = $liste.PointToClient((New-Object System.Drawing.Point($e.X, $e.Y)))
            $treffer = $liste.HitTest($stelle.X, $stelle.Y)
            $passt = $treffer.Item -and $treffer.Item.Tag -and $treffer.Item.Tag.Art -eq 'ueberschrift' -and $treffer.Item.Tag.ArtKat -eq 'baustein'
            $e.Effect = if ($passt) { 'Move' } else { 'None' }
        }.GetNewClosure())
        $liste.Add_DragDrop({
            param($absender, $e)

            # Weitergabedatei von außen: übernehmen statt verschieben
            if (-not $e.Data.GetDataPresent('DocKitBaustein') -and (& $istWeitergabedatei $e.Data)) {
                $fenster.TopMost = $false
                try {
                    foreach ($f in @($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop))) {
                        $endung = [System.IO.Path]::GetExtension([string]$f)
                        if ($endung -ne $global:WeitergabeEndung -and $endung -ne $global:Dateiendung) { continue }
                        [void](Zeige-Uebernahme ([string]$f))
                    }
                } finally { $fenster.TopMost = $true }
                & $fuelle
                return
            }

            if (-not $e.Data.GetDataPresent('DocKitBaustein')) { return }
            $stelle = $liste.PointToClient((New-Object System.Drawing.Point($e.X, $e.Y)))
            $treffer = $liste.HitTest($stelle.X, $stelle.Y)
            if ($null -eq $treffer.Item -or $null -eq $treffer.Item.Tag) { return }
            if ($treffer.Item.Tag.Art -ne 'ueberschrift' -or $treffer.Item.Tag.ArtKat -ne 'baustein') { return }
            $baustein = $e.Data.GetData('DocKitBaustein')
            $neueKat = & $katAusSchluessel ([string]$treffer.Item.Tag.Schluessel)
            if ([string]$baustein.kategorie -eq $neueKat) { return }
            $baustein.kategorie = $neueKat
            if ($null -ne $baustein.PSObject.Properties['geaendert_von']) {
                $baustein.geaendert_von = $env:USERNAME
                $baustein.geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
            }
            if (& $speichereStill) { & $fuelle }
        }.GetNewClosure())

        $knopfVerwalten.Add_Click({
            $global:SchnellwahlAuswahl = $null
            $global:SchnellwahlWeiter = 'verwalten'
            $fenster.Close()
        }.GetNewClosure())

        <#
            Die Einstellungen öffnen sich über der Übersicht, ohne sie zu schließen.
            Das TopMost der Übersicht muss dafür kurz weichen, sonst läge sie davor.
        #>
        $knopfZahnrad.Add_Click({
            $fenster.TopMost = $false
            try { Zeige-Einstellungen } finally { $fenster.TopMost = $true }
            & $fuelle
            [void]$suchfeld.Focus()
        }.GetNewClosure())

        $fuss.Add_Resize({
            $tastenhilfe.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $tastenhilfe.Width), 15)
            $knopfVerwalten.Location = New-Object System.Drawing.Point(($tastenhilfe.Left - 24 - $knopfVerwalten.Width), 9)
            $knopfVorschauUebersicht.Location = New-Object System.Drawing.Point(($knopfVerwalten.Left - 10 - $knopfVorschauUebersicht.Width), 9)
            # Die Statuszeile endet, wo die Knöpfe beginnen — sonst überlappt sie.
            $status.MaximumSize = New-Object System.Drawing.Size(([Math]::Max(80, $knopfVorschauUebersicht.Left - $status.Left - 16)), 0)
        }.GetNewClosure())

        $fenster.Add_Shown({
            & $fuelleDateien
            & $fuelle
            [DocKit.Windows]::Platzhaltertext($suchfeld.Handle, 'Tippen zum Suchen — Name, Kürzel oder Stichwort')
            & $setzeZahnrad
            $tastenhilfe.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $tastenhilfe.Width), 15)
            $knopfVerwalten.Location = New-Object System.Drawing.Point(($tastenhilfe.Left - 24 - $knopfVerwalten.Width), 9)
            $knopfVorschauUebersicht.Location = New-Object System.Drawing.Point(($knopfVerwalten.Left - 10 - $knopfVorschauUebersicht.Width), 9)
            # Die Statuszeile endet, wo die Knöpfe beginnen — sonst überlappt sie.
            $status.MaximumSize = New-Object System.Drawing.Size(([Math]::Max(80, $knopfVorschauUebersicht.Left - $status.Left - 16)), 0)
            [DocKit.Windows]::FokusZurueck($fenster.Handle)
            [void]$suchfeld.Focus()
        }.GetNewClosure())

        $global:SchnellwahlWeiter = ''
        [void]$fenster.ShowDialog()
        $fenster.Dispose()

    } finally {
        $global:SchnellwahlOffen = $false
    }

    # --- Nach dem Schließen: das Gewählte verarbeiten ---
    # Nach dem Verwalten geht es zurück in die Übersicht — sonst müsste man sie
    # jedes Mal neu aufrufen.
    if ($global:SchnellwahlWeiter -eq 'verwalten') {
        Zeige-Verwaltung
        Zeige-Schnellwahl
        return
    }

    $auswahl = $global:SchnellwahlAuswahl
    if ($null -eq $auswahl) { return }

    # --- Vorlage: Kopie anlegen und auf Wunsch gleich einen Baustein hineinschreiben ---
    if ($auswahl.Art -eq 'vorlage') {
        Benutze-Vorlage $auswahl.Objekt
        return
    }

    # --- Kombination: Kopie anlegen und direkt mit dem verknüpften Baustein füllen ---
    if ($auswahl.Art -eq 'kombination') {
        Benutze-Kombination $auswahl.Objekt
        return
    }

    $aktion = Benutze-Baustein -Baustein $auswahl.Objekt -Zielfenster $global:Zielfenster
    if ($aktion -eq 'abbruch') {
        # Abgebrochen heißt nur: dieser Baustein doch nicht. Zurück in die
        # Übersicht, statt das ganze Fenster wegzuklicken.
        Zeige-Schnellwahl
    }
}


# =====================================================================
#  8. VERWALTUNG — Bausteine anlegen und bearbeiten
# =====================================================================

<#
    Der Feldeditor. Hier wird festgelegt, was der Assistent später abfragt:
    ein Textfeld, eine Auswahlliste, ein Datum oder ein Ja/Nein-Schalter.
    Das übergebene Feld wird bei "Übernehmen" direkt geändert.
#>
<#
    Ein einzelner Eintrag einer Auswahlliste. Getrennt nach dem, was in der Liste
    steht, und dem, was eingefügt wird — Letzteres darf beliebig lang und
    mehrzeilig sein. Die frühere Schreibweise "Anzeige = Wert" in einer Zeile
    reichte für Sätze wie eine Einstellungsverfügung nicht aus.
#>
<#
    Alle Felder, die irgendwo in dieser Textbausteindatei schon einmal gebaut
    wurden — je Name nur einmal. Damit lässt sich ein einmal erstelltes Feld in
    jeden anderen Baustein übernehmen, statt es nachzubauen.
#>
function Sammle-Alle-Felder {
    param($AusserBaustein = $null)
    $gefunden = New-Object System.Collections.ArrayList
    $namen = New-Object System.Collections.Generic.HashSet[string]
    foreach ($b in @($global:Bausteine)) {
        foreach ($f in @($b.felder)) {
            if ($null -eq $f -or [string]::IsNullOrWhiteSpace($f.name)) { continue }
            $schluessel = ([string]$f.name).ToLower()
            if ($namen.Contains($schluessel)) { continue }
            [void]$namen.Add($schluessel)
            [void]$gefunden.Add([pscustomobject]@{
                Feld     = $f
                Name     = [string]$f.name
                Typ      = $(if ($global:Feldtypen.Contains([string]$f.typ)) { $global:Feldtypen[[string]$f.typ] } else { [string]$f.typ })
                Herkunft = [string]$b.name
                Schon    = $(if ($AusserBaustein) { @(@($AusserBaustein.felder) | Where-Object { [string]$_.name -eq [string]$f.name }).Count -gt 0 } else { $false })
            })
        }
    }
    return , $gefunden
}

# Tiefe Kopie eines Feldes, damit das Original beim Bearbeiten unberührt bleibt.
function Kopiere-Feld {
    param($Feld)
    $kopie = $Feld | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $vorlage = Neues-Feld
    foreach ($p in $vorlage.PSObject.Properties) {
        if ($null -eq $kopie.PSObject.Properties[$p.Name]) {
            Add-Member -InputObject $kopie -MemberType NoteProperty -Name $p.Name -Value $p.Value
        }
    }
    $kopie.optionen = @($kopie.optionen)
    return $kopie
}

<#
    Auswahl aus dem Bestand aller schon gebauten Felder.
    Rückgabe: eine Kopie des gewählten Feldes, oder $null.
#>
function Waehle-Vorhandenes-Feld {
    param($Baustein)

    $bestand = Sammle-Alle-Felder -AusserBaustein $Baustein
    if (@($bestand).Count -eq 0) {
        Zeige-Meldung 'In dieser Textbausteindatei gibt es noch keine Felder, die sich übernehmen ließen.' 'Nichts vorhanden'
        return $null
    }

    $fenster = Neues-Fenster -Titel 'Vorhandenes Feld übernehmen' -Breite 760 -Hoehe 500
    $fenster.MinimumSize = New-Object System.Drawing.Size(600, 400)

    $kopf = New-Object System.Windows.Forms.Panel
    $kopf.Dock = 'Top'; $kopf.Height = 62; $kopf.BackColor = $global:Farbe.Flaeche
    $hinweis = Neue-Beschriftung -Text ('Diese Felder wurden in dieser Datei schon gebaut. Das gewählte wird als Kopie ' +
        'in den Baustein übernommen — samt Auswahleinträgen und Bedingung.') -Klein
    $hinweis.MaximumSize = New-Object System.Drawing.Size(700, 0)
    $hinweis.Location = New-Object System.Drawing.Point(16, 14)
    $kopf.Controls.Add($hinweis)

    $liste = New-Object System.Windows.Forms.ListView
    $liste.Dock = 'Fill'; $liste.View = 'Details'; $liste.FullRowSelect = $true
    $liste.MultiSelect = $false; $liste.HideSelection = $false
    $liste.HeaderStyle = 'Nonclickable'; $liste.BorderStyle = 'None'
    $liste.BackColor = $global:Farbe.Flaeche
    [void]$liste.Columns.Add('Feld', 200)
    [void]$liste.Columns.Add('Art', 260)
    [void]$liste.Columns.Add('Zuerst gebaut in', 250)

    foreach ($e in @($bestand | Sort-Object Name)) {
        $z = New-Object System.Windows.Forms.ListViewItem("{$($e.Name)}")
        [void]$z.SubItems.Add($e.Typ)
        [void]$z.SubItems.Add($e.Herkunft)
        if ($e.Schon) {
            $z.ForeColor = $global:Farbe.Grau
            $z.SubItems[2].Text = $e.Herkunft + '   — steckt hier schon drin'
        }
        $z.Tag = $e
        [void]$liste.Items.Add($z)
    }

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 54; $fuss.BackColor = $global:Farbe.Flaeche
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 150 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))

    $fenster.Controls.Add($liste); $fenster.Controls.Add($fuss); $fenster.Controls.Add($kopf)

    $global:FeldwahlErgebnis = $null

    $nimm = {
        if ($liste.SelectedItems.Count -eq 0) { return }
        $e = $liste.SelectedItems[0].Tag
        if ($e.Schon) {
            Zeige-Meldung "Ein Feld namens {$($e.Name)} gibt es in diesem Baustein bereits." 'Schon vorhanden' 'Warning'
            return
        }
        $global:FeldwahlErgebnis = Kopiere-Feld $e.Feld
        $fenster.Close()
    }.GetNewClosure()

    $knopfOk.Add_Click($nimm)
    $liste.Add_DoubleClick($nimm)
    $knopfAus.Add_Click({ $global:FeldwahlErgebnis = $null; $fenster.Close() }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 10)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 10)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({
        & $ordne
        if ($liste.Items.Count -gt 0) { $liste.Items[0].Selected = $true }
        [void]$liste.Focus()
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:FeldwahlErgebnis
}

function Zeige-Optionseditor {
    param($Option, $Feldnamen = @())

    # Bewusst groß: Die Texte sind teilweise ganze Absätze, etwa eine
    # Einstellungsverfügung. In einem kleinen Feld arbeitet damit niemand gern.
    $fenster = Neues-Fenster -Titel 'Eintrag der Auswahlliste' -Breite 900 -Hoehe 660 -Rahmen 'Sizable'
    $fenster.MinimumSize = New-Object System.Drawing.Size(640, 480)

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'
    $flaeche.BackColor = $global:Farbe.Flaeche
    $flaeche.Padding = New-Object System.Windows.Forms.Padding(20, 16, 20, 8)
    $fenster.Controls.Add($flaeche)

    $kopfbereich = New-Object System.Windows.Forms.Panel
    $kopfbereich.Dock = 'Top'
    $kopfbereich.Height = 118

    $lAnzeige = Neue-Beschriftung -Text 'Kurzbezeichnung — was in der Klappliste steht' -Fett
    $eAnzeige = Neues-Eingabefeld -Breite 600
    $eAnzeige.Anchor = 'Top,Left,Right'
    $eAnzeige.Text = [string]$Option.anzeige
    $hAnzeige = Neue-Beschriftung -Text 'Kurz halten, etwa „170 Absatz 2" oder „153a". Den vollen Wortlaut trägst du unten ein.' -Klein

    $y = 0
    Setze-Unter $kopfbereich $lAnzeige ([ref]$y) 0 3
    Setze-Unter $kopfbereich $eAnzeige ([ref]$y) 0 3
    Setze-Unter $kopfbereich $hAnzeige ([ref]$y) 0 0
    $kopfbereich.Height = $hAnzeige.Bottom + 14

    $wertRahmen = New-Object System.Windows.Forms.GroupBox
    $wertRahmen.Text = ' Was eingefügt wird '
    $wertRahmen.Dock = 'Fill'
    $wertRahmen.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 8)

    $wertLeiste = New-Object System.Windows.Forms.Panel
    $wertLeiste.Dock = 'Top'
    $wertLeiste.Height = 34
    $knopfMarke = Neuer-Knopf -Text 'Platzhalter einfügen  ▾' -Breite 176 -Hoehe 25
    $knopfMarke.Font = $global:SchriftKlein
    $knopfMarke.Location = New-Object System.Drawing.Point(0, 3)
    $hWert = Neue-Beschriftung -Text 'Darf mehrere Zeilen lang sein. Zeilenumbrüche bleiben erhalten.' -Klein
    $hWert.Location = New-Object System.Drawing.Point(186, 9)
    $wertLeiste.Controls.AddRange(@($knopfMarke, $hWert))

    $eWert = New-Object System.Windows.Forms.TextBox
    $eWert.Multiline = $true
    $eWert.Dock = 'Fill'
    $eWert.ScrollBars = 'Vertical'
    $eWert.WordWrap = $true          # lange Sätze umbrechen statt rechts verschwinden
    $eWert.BorderStyle = 'FixedSingle'
    $eWert.AcceptsReturn = $true
    $eWert.Text = [string]$Option.wert

    $wertRahmen.Controls.Add($eWert)
    $wertRahmen.Controls.Add($wertLeiste)

    $flaeche.Controls.Add($wertRahmen)
    $flaeche.Controls.Add($kopfbereich)

    <#
        Reihenfolge für den Tabulator: von der Kurzbezeichnung direkt in den
        Text. Ohne diese Vorgabe richtet sie sich danach, in welcher Reihenfolge
        die Bereiche hinzugefügt wurden — und der Text kommt oben zuerst dran,
        weil er im zuerst hinzugefügten Rahmen sitzt.
        Ein mehrzeiliges Textfeld gibt den Tabulator von sich aus weiter
        (AcceptsTab bleibt aus); die Tabulatortaste schreibt also kein Zeichen.
    #>
    $kopfbereich.TabIndex = 0
    $eAnzeige.TabIndex    = 0
    $wertRahmen.TabIndex  = 1
    $eWert.TabIndex       = 0
    $wertLeiste.TabIndex  = 1

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'
    $fuss.Height = 56
    $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)

    $knopfMarke.Add_Click({
        Zeige-Platzhaltermenue $knopfMarke $eWert $Feldnamen
    }.GetNewClosure())

    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if ([string]::IsNullOrWhiteSpace($eAnzeige.Text) -and [string]::IsNullOrWhiteSpace($eWert.Text)) {
            Zeige-Meldung 'Bitte wenigstens eine Beschriftung eingeben.' 'Eintrag leer' 'Warning'
            return
        }
        $Option.anzeige = $eAnzeige.Text.Trim()
        $Option.wert    = $eWert.Text
        if ([string]::IsNullOrWhiteSpace($Option.anzeige)) { $Option.anzeige = $Option.wert }
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({ & $ordne; [void]$eAnzeige.Focus() }.GetNewClosure())

    $ergebnis = ($fenster.ShowDialog() -eq 'OK')
    $fenster.Dispose()
    return $ergebnis
}

function Zeige-Feldeditor {
    param($Feld, $Geschwister = @())

    # Ältere Felder aus einer von Hand bearbeiteten Datei kennen die Bedingung noch nicht.
    foreach ($p in @('zeigen_wenn_feld', 'zeigen_wenn_wert')) {
        if ($null -eq $Feld.PSObject.Properties[$p]) {
            Add-Member -InputObject $Feld -MemberType NoteProperty -Name $p -Value ''
        }
    }

    $fenster = Neues-Fenster -Titel 'Feld bearbeiten' -Breite 620 -Hoehe 740 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false
    $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'
    $flaeche.BackColor = $global:Farbe.Flaeche
    $flaeche.Padding = New-Object System.Windows.Forms.Padding(16)
    $fenster.Controls.Add($flaeche)

    $lName = Neue-Beschriftung -Text 'Name des Feldes' -Fett
    $eName = Neues-Eingabefeld -Breite 560
    $eName.Anchor = 'Top,Left,Right'
    $eName.Text = [string]$Feld.name

    $hName = Neue-Beschriftung -Text 'Unter diesem Namen wird das Feld im Text verwendet, z. B. {Anrede}.' -Klein

    $lTyp = Neue-Beschriftung -Text 'Art des Feldes' -Fett
    $eTyp = New-Object System.Windows.Forms.ComboBox
    $eTyp.DropDownStyle = 'DropDownList'
    $eTyp.Width = 380
    foreach ($schluessel in $global:Feldtypen.Keys) {
        [void]$eTyp.Items.Add((New-Object DocKit.Option($global:Feldtypen[$schluessel], $schluessel)))
    }
    for ($i = 0; $i -lt $eTyp.Items.Count; $i++) {
        if ($eTyp.Items[$i].Wert -eq [string]$Feld.typ) { $eTyp.SelectedIndex = $i; break }
    }
    if ($eTyp.SelectedIndex -lt 0) { $eTyp.SelectedIndex = 0 }

    $lHinweis = Neue-Beschriftung -Text 'Hinweis für den Anwender (optional)' -Fett
    $eHinweis = Neues-Eingabefeld -Breite 560
    $eHinweis.Anchor = 'Top,Left,Right'
    $eHinweis.Text = [string]$Feld.hinweis

    $lStandard = Neue-Beschriftung -Text 'Vorbelegung' -Fett
    $eStandard = Neues-Eingabefeld -Breite 380
    $eStandard.Text = [string]$Feld.standard
    $hStandard = Neue-Beschriftung -Text '' -Klein
    $hStandard.AutoSize = $false
    $hStandard.Size = New-Object System.Drawing.Size(560, 34)
    $hStandard.Anchor = 'Top,Left,Right'

    # --- Abhängigkeit: dieses Feld nur zeigen, wenn ein anderes auf einem Wert steht ---
    $lBedingung = Neue-Beschriftung -Text 'Dieses Feld nur anzeigen, wenn …' -Fett

    $pBedingung = New-Object System.Windows.Forms.Panel
    $pBedingung.Size = New-Object System.Drawing.Size(560, 30)
    $pBedingung.Anchor = 'Top,Left,Right'

    $cbBedFeld = New-Object System.Windows.Forms.ComboBox
    $cbBedFeld.DropDownStyle = 'DropDownList'
    $cbBedFeld.Width = 230
    $cbBedFeld.Location = New-Object System.Drawing.Point(0, 0)
    [void]$cbBedFeld.Items.Add((New-Object DocKit.Option('(immer anzeigen)', '')))
    foreach ($g in @($Geschwister)) {
        if ($null -eq $g) { continue }
        if ([string]$g.name -eq [string]$Feld.name) { continue }          # nicht auf sich selbst
        if (@('auswahl', 'schalter') -notcontains [string]$g.typ) { continue }
        [void]$cbBedFeld.Items.Add((New-Object DocKit.Option("{$($g.name)}", [string]$g.name)))
    }

    $lbGleich = Neue-Beschriftung -Text 'steht auf'
    $lbGleich.Location = New-Object System.Drawing.Point(240, 5)

    $cbBedWert = New-Object System.Windows.Forms.ComboBox
    $cbBedWert.DropDownStyle = 'DropDownList'
    $cbBedWert.Width = 220
    $cbBedWert.Location = New-Object System.Drawing.Point(310, 0)

    $pBedingung.Controls.AddRange(@($cbBedFeld, $lbGleich, $cbBedWert))

    $hBedingung = Neue-Beschriftung -Text 'Damit lassen sich Felder verschachteln: Das Datumsfeld erscheint zum Beispiel erst, wenn oben „bis zum Datum" gewählt wurde.' -Klein
    $hBedingung.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $y = 16
    Setze-Unter $flaeche $lName      ([ref]$y) 16 2
    Setze-Unter $flaeche $eName      ([ref]$y) 16 3
    Setze-Unter $flaeche $hName      ([ref]$y) 16 14
    Setze-Unter $flaeche $lTyp       ([ref]$y) 16 2
    Setze-Unter $flaeche $eTyp       ([ref]$y) 16 14
    Setze-Unter $flaeche $lHinweis   ([ref]$y) 16 2
    Setze-Unter $flaeche $eHinweis   ([ref]$y) 16 14
    Setze-Unter $flaeche $lStandard  ([ref]$y) 16 2
    Setze-Unter $flaeche $eStandard  ([ref]$y) 16 3
    Setze-Unter $flaeche $hStandard  ([ref]$y) 16 10
    Setze-Unter $flaeche $lBedingung ([ref]$y) 16 4
    Setze-Unter $flaeche $pBedingung ([ref]$y) 16 3
    Setze-Unter $flaeche $hBedingung ([ref]$y) 16 12

    # --- Wechselnder Bereich: Auswahlliste oder Ja/Nein-Texte ---
    $bereich = New-Object System.Windows.Forms.Panel
    $bereich.Location = New-Object System.Drawing.Point(16, $y)
    $bereich.Size = New-Object System.Drawing.Size(560, 190)
    $bereich.Anchor = 'Top,Left,Right,Bottom'
    $flaeche.Controls.Add($bereich)

    # Auswahlliste
    $pAuswahl = New-Object System.Windows.Forms.Panel
    $pAuswahl.Dock = 'Fill'
    $lAuswahl = Neue-Beschriftung -Text 'Einträge der Auswahlliste' -Fett
    $hAuswahl = Neue-Beschriftung -Text 'Doppelklick zum Bearbeiten. Der einzufügende Text darf beliebig lang und mehrzeilig sein.' -Klein
    $hAuswahl.MaximumSize = New-Object System.Drawing.Size(556, 0)

    # Arbeitsliste: erst bei "Übernehmen" wandert sie ins Feld zurück.
    $optionen = New-Object System.Collections.ArrayList
    foreach ($o in (Lies-Optionen $Feld)) {
        [void]$optionen.Add([pscustomobject]@{ anzeige = [string]$o.Anzeige; wert = [string]$o.Wert })
    }

    $auswahlListe = New-Object System.Windows.Forms.ListView
    $auswahlListe.View = 'Details'
    $auswahlListe.FullRowSelect = $true
    $auswahlListe.MultiSelect = $false
    $auswahlListe.HideSelection = $false
    $auswahlListe.HeaderStyle = 'Nonclickable'
    $auswahlListe.BorderStyle = 'FixedSingle'
    $auswahlListe.BackColor = $global:Farbe.Flaeche
    $auswahlListe.Size = New-Object System.Drawing.Size(410, 120)
    $auswahlListe.Anchor = 'Top,Left,Right,Bottom'
    [void]$auswahlListe.Columns.Add('In der Liste', 150)
    [void]$auswahlListe.Columns.Add('Wird eingefügt', 250)

    $auswahlKnoepfe = New-Object System.Windows.Forms.Panel
    $auswahlKnoepfe.Size = New-Object System.Drawing.Size(140, 120)
    $auswahlKnoepfe.Anchor = 'Top,Right,Bottom'
    $kOptNeu    = Neuer-Knopf -Text 'Neuer Eintrag' -Breite 132 -Hoehe 26
    $kOptBearb  = Neuer-Knopf -Text 'Bearbeiten' -Breite 132 -Hoehe 26
    $kOptWeg    = Neuer-Knopf -Text 'Entfernen' -Breite 132 -Hoehe 26
    $kOptHoch   = Neuer-Knopf -Text 'Nach oben' -Breite 132 -Hoehe 26
    $kOptRunter = Neuer-Knopf -Text 'Nach unten' -Breite 132 -Hoehe 26
    $kOptNeu.Location    = New-Object System.Drawing.Point(8, 0)
    $kOptBearb.Location  = New-Object System.Drawing.Point(8, 30)
    $kOptWeg.Location    = New-Object System.Drawing.Point(8, 60)
    $kOptHoch.Location   = New-Object System.Drawing.Point(8, 96)
    $kOptRunter.Location = New-Object System.Drawing.Point(8, 126)
    $auswahlKnoepfe.Controls.AddRange(@($kOptNeu, $kOptBearb, $kOptWeg, $kOptHoch, $kOptRunter))

    $yA = 0
    Setze-Unter $pAuswahl $lAuswahl ([ref]$yA) 0 2
    Setze-Unter $pAuswahl $hAuswahl ([ref]$yA) 0 6
    $auswahlListe.Location   = New-Object System.Drawing.Point(0, $yA)
    $auswahlKnoepfe.Location = New-Object System.Drawing.Point(416, $yA)
    $pAuswahl.Controls.AddRange(@($auswahlListe, $auswahlKnoepfe))

    # Ja/Nein
    $pSchalter = New-Object System.Windows.Forms.Panel
    $pSchalter.Dock = 'Fill'
    $knopfMarkeJa = Neuer-Knopf -Text 'Platzhalter einfügen  ▾' -Breite 176 -Hoehe 24
    $knopfMarkeJa.Font = $global:SchriftKlein
    $hSchalterMarken = Neue-Beschriftung -Text 'In diesen Texten dürfen wieder Platzhalter stehen — auch solche aus Feldern, die erst bei „ja" erscheinen.' -Klein
    $hSchalterMarken.MaximumSize = New-Object System.Drawing.Size(556, 0)

    $lJa = Neue-Beschriftung -Text 'Text, wenn »ja« angehakt ist' -Fett
    $eJa = Neues-Eingabefeld -Breite 556 -Mehrzeilig -Hoehe 62
    $eJa.Anchor = 'Top,Left,Right'
    $eJa.Text = [string]$Feld.wenn_ja
    $lNein = Neue-Beschriftung -Text 'Text, wenn »nein« angehakt ist (meist leer lassen)' -Fett
    $eNein = Neues-Eingabefeld -Breite 556 -Mehrzeilig -Hoehe 62
    $eNein.Anchor = 'Top,Left,Right'
    $eNein.Text = [string]$Feld.wenn_nein
    $yS = 0
    Setze-Unter $pSchalter $hSchalterMarken ([ref]$yS) 0 4
    Setze-Unter $pSchalter $knopfMarkeJa    ([ref]$yS) 0 8
    Setze-Unter $pSchalter $lJa   ([ref]$yS) 0 2
    Setze-Unter $pSchalter $eJa   ([ref]$yS) 0 12
    Setze-Unter $pSchalter $lNein ([ref]$yS) 0 2
    Setze-Unter $pSchalter $eNein ([ref]$yS) 0 0

    $bereich.Controls.AddRange(@($pAuswahl, $pSchalter))

    <#
        Der Platzhalterknopf schreibt in das Feld, in dem zuletzt der Cursor stand —
        so lässt sich sowohl der Ja- als auch der Nein-Text bestücken.
        Angeboten werden die übrigen Felder des Bausteins: genau damit entsteht die
        Verschachtelung "Ja/Nein blendet ein Feld ein, dessen Wert im Ja-Text steht".
    #>
    $markenZiel = @{ Feld = $eJa }
    $eJa.Add_Enter({ $markenZiel.Feld = $eJa }.GetNewClosure())
    $eNein.Add_Enter({ $markenZiel.Feld = $eNein }.GetNewClosure())

    # --- Einträge der Auswahlliste verwalten ---
    $geschwisterNamen = @()
    foreach ($g in @($Geschwister)) {
        if ($null -eq $g) { continue }
        if ([string]$g.name -eq [string]$Feld.name) { continue }
        $geschwisterNamen += [string]$g.name
    }

    $zeigeOptionen = {
        $auswahlListe.BeginUpdate()
        $auswahlListe.Items.Clear()
        foreach ($o in $optionen) {
            $e = New-Object System.Windows.Forms.ListViewItem([string]$o.anzeige)
            $vorschau = ([string]$o.wert) -replace "\r?\n", ' ⏎ '
            if ($vorschau.Length -gt 90) { $vorschau = $vorschau.Substring(0, 90) + ' …' }
            [void]$e.SubItems.Add($vorschau)
            $e.Tag = $o
            [void]$auswahlListe.Items.Add($e)
        }
        $auswahlListe.EndUpdate()
    }.GetNewClosure()

    $optIndex = { if ($auswahlListe.SelectedIndices.Count -eq 0) { return -1 } else { return $auswahlListe.SelectedIndices[0] } }.GetNewClosure()

    $kOptNeu.Add_Click({
        $neu = [pscustomobject]@{ anzeige = ''; wert = '' }
        if (Zeige-Optionseditor -Option $neu -Feldnamen $geschwisterNamen) {
            [void]$optionen.Add($neu)
            & $zeigeOptionen
            $auswahlListe.Items[$auswahlListe.Items.Count - 1].Selected = $true
        }
    }.GetNewClosure())

    $bearbeiteOption = {
        $i = & $optIndex
        if ($i -lt 0) { return }
        if (Zeige-Optionseditor -Option $optionen[$i] -Feldnamen $geschwisterNamen) {
            & $zeigeOptionen
            $auswahlListe.Items[$i].Selected = $true
        }
    }.GetNewClosure()

    $kOptBearb.Add_Click($bearbeiteOption)
    $auswahlListe.Add_DoubleClick($bearbeiteOption)

    $kOptWeg.Add_Click({
        $i = & $optIndex
        if ($i -lt 0) { return }
        if (-not (Frage-Ja-Nein "Den Eintrag »$($optionen[$i].anzeige)« entfernen?" 'Eintrag entfernen')) { return }
        $optionen.RemoveAt($i)
        & $zeigeOptionen
    }.GetNewClosure())

    $schiebeOption = {
        param([int]$Richtung)
        $i = & $optIndex
        $neu = $i + $Richtung
        if ($i -lt 0 -or $neu -lt 0 -or $neu -ge $optionen.Count) { return }
        $o = $optionen[$i]
        $optionen.RemoveAt($i)
        $optionen.Insert($neu, $o)
        & $zeigeOptionen
        $auswahlListe.Items[$neu].Selected = $true
    }.GetNewClosure()

    $kOptHoch.Add_Click({ & $schiebeOption -1 }.GetNewClosure())
    $kOptRunter.Add_Click({ & $schiebeOption 1 }.GetNewClosure())

    $knopfMarkeJa.Add_Click({
        $namen = @()
        foreach ($g in @($Geschwister)) {
            if ($null -eq $g) { continue }
            if ([string]$g.name -eq [string]$Feld.name) { continue }     # nicht auf sich selbst
            $namen += [string]$g.name
        }
        Zeige-Platzhaltermenue $knopfMarkeJa $markenZiel.Feld $namen
    }.GetNewClosure())

    # --- Knöpfe ---
    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'
    $fuss.Height = 56
    $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor  = 'Top,Right'
    $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)

    $ordne = {
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure()

    $zeigeBereich = {
        $typ = $eTyp.SelectedItem.Wert
        $pAuswahl.Visible  = ($typ -eq 'auswahl')
        $pSchalter.Visible = ($typ -eq 'schalter')
        switch ($typ) {
            'datum'    { $hStandard.Text = 'Erlaubt: heute, morgen, gestern, +7, -3 oder ein festes Datum wie 24.12.2026.' }
            'uhrzeit'  { $hStandard.Text = 'Erlaubt: eine Uhrzeit wie 08:30. Leer lassen für die aktuelle Uhrzeit.' }
            'auswahl'  { $hStandard.Text = 'Welcher Eintrag soll vorausgewählt sein? Leer lassen für den ersten.' }
            'schalter' { $hStandard.Text = 'ja oder nein — wie der Haken beim Öffnen gesetzt sein soll.' }
            'zahl'     { $hStandard.Text = 'Eine Zahl, mit der das Feld vorbelegt wird.' }
            default    { $hStandard.Text = 'Text, mit dem das Feld vorbelegt wird. Darf leer bleiben.' }
        }
    }.GetNewClosure()

    # Die Werteliste richtet sich danach, welches Feld als Bedingung gewählt wurde.
    $fuelleBedWert = {
        param([string]$Vorauswahl)
        $cbBedWert.Items.Clear()
        $name = ''
        if ($cbBedFeld.SelectedItem) { $name = [string]$cbBedFeld.SelectedItem.Wert }
        $quelle = $null
        foreach ($g in @($Geschwister)) { if ($null -ne $g -and [string]$g.name -eq $name) { $quelle = $g; break } }
        if ($null -eq $quelle) { $cbBedWert.Enabled = $false; return }

        $cbBedWert.Enabled = $true
        if ([string]$quelle.typ -eq 'schalter') {
            [void]$cbBedWert.Items.Add((New-Object DocKit.Option('ja — Haken gesetzt', 'ja')))
            [void]$cbBedWert.Items.Add((New-Object DocKit.Option('nein — Haken nicht gesetzt', 'nein')))
        } else {
            foreach ($o in (Lies-Optionen $quelle)) {
                [void]$cbBedWert.Items.Add((New-Object DocKit.Option($o.Anzeige, $o.Anzeige)))
            }
        }
        for ($i = 0; $i -lt $cbBedWert.Items.Count; $i++) {
            if ($cbBedWert.Items[$i].Wert -eq $Vorauswahl) { $cbBedWert.SelectedIndex = $i; return }
        }
        if ($cbBedWert.Items.Count -gt 0) { $cbBedWert.SelectedIndex = 0 }
    }.GetNewClosure()

    $cbBedFeld.Add_SelectedIndexChanged({ & $fuelleBedWert '' }.GetNewClosure())

    $cbBedFeld.SelectedIndex = 0
    for ($i = 0; $i -lt $cbBedFeld.Items.Count; $i++) {
        if ($cbBedFeld.Items[$i].Wert -eq [string]$Feld.zeigen_wenn_feld) { $cbBedFeld.SelectedIndex = $i; break }
    }
    & $fuelleBedWert ([string]$Feld.zeigen_wenn_wert)

    $eTyp.Add_SelectedIndexChanged($zeigeBereich)
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown({
        # Erst wenn das Fenster steht, ist die endgültige Höhe bekannt.
        $bereich.Height = [Math]::Max(140, $flaeche.ClientSize.Height - $bereich.Top - 12)
        $hoeheListe = [Math]::Max(90, $pAuswahl.ClientSize.Height - $auswahlListe.Top)
        $auswahlListe.Height = $hoeheListe
        $auswahlListe.Width = [Math]::Max(300, $pAuswahl.ClientSize.Width - 156)
        $auswahlKnoepfe.Left = $auswahlListe.Right + 6
        $auswahlKnoepfe.Height = $hoeheListe
        $auswahlListe.Columns[1].Width = [Math]::Max(180, $auswahlListe.ClientSize.Width - 156)
        $eNein.Height = [Math]::Max(50, $pSchalter.ClientSize.Height - $eNein.Top)
        & $ordne
        & $zeigeBereich
        & $zeigeOptionen
        [void]$eName.Focus()
    }.GetNewClosure())

    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if ([string]::IsNullOrWhiteSpace($eName.Text)) {
            Zeige-Meldung 'Bitte einen Namen für das Feld eingeben.' 'Name fehlt' 'Warning'
            return
        }
        if ($eName.Text -match '[{}]') {
            Zeige-Meldung 'Der Name darf keine geschweiften Klammern enthalten — die setzt das Programm selbst.' 'Ungültiger Name' 'Warning'
            return
        }
        $Feld.name     = $eName.Text.Trim()
        $Feld.typ      = $eTyp.SelectedItem.Wert
        $Feld.hinweis  = $eHinweis.Text
        $Feld.standard = $eStandard.Text

        # Die Einträge kommen jetzt aus der verwalteten Liste, nicht mehr aus
        # einer Zeile je Eintrag — dadurch dürfen sie beliebig lang sein.
        $neueOptionen = New-Object System.Collections.ArrayList
        foreach ($o in $optionen) {
            if ([string]::IsNullOrWhiteSpace($o.anzeige) -and [string]::IsNullOrWhiteSpace($o.wert)) { continue }
            $anzeige = [string]$o.anzeige
            if ([string]::IsNullOrWhiteSpace($anzeige)) { $anzeige = [string]$o.wert }
            [void]$neueOptionen.Add([pscustomobject]@{ anzeige = $anzeige; wert = [string]$o.wert })
        }
        $Feld.optionen  = @($neueOptionen)
        $Feld.wenn_ja   = $eJa.Text
        $Feld.wenn_nein = $eNein.Text

        if ($null -eq $cbBedFeld.SelectedItem -or [string]::IsNullOrEmpty($cbBedFeld.SelectedItem.Wert)) {
            $Feld.zeigen_wenn_feld = ''
            $Feld.zeigen_wenn_wert = ''
        } else {
            $Feld.zeigen_wenn_feld = [string]$cbBedFeld.SelectedItem.Wert
            $Feld.zeigen_wenn_wert = if ($cbBedWert.SelectedItem) { [string]$cbBedWert.SelectedItem.Wert } else { '' }
        }

        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $ergebnis = ($fenster.ShowDialog() -eq 'OK')
    $fenster.Dispose()
    return $ergebnis
}


<#
    Das Verwaltungsfenster. Links der Baum aller Bausteine, rechts der gewählte
    Baustein. Änderungen wirken sofort im Arbeitsspeicher; auf die Festplatte
    kommen sie erst mit "Speichern".
#>
function Zeige-Verwaltung {

    if ($global:VerwaltungOffen) { return }
    $global:VerwaltungOffen = $true
    $global:VerwaltungGeaendert = $false
    if ($null -eq $global:Vorlagen) { $global:Vorlagen = New-Object System.Collections.ArrayList }
    if ($null -eq $global:Bausteine) { $global:Bausteine = New-Object System.Collections.ArrayList }
    if ($null -eq $global:Kombinationen) { $global:Kombinationen = New-Object System.Collections.ArrayList }
    $global:Laedt = $false
    $global:AktuellerBaustein = $null

    $zusatz = if ($global:NurLesen) { '   [nur lesen]' } else { '' }
    $fenster = Neues-Fenster -Titel "Bausteine verwalten — $(Dateiname-Kurz $global:BausteinDatei)$zusatz" -Breite 1120 -Hoehe 720
    $fenster.MinimumSize = New-Object System.Drawing.Size(900, 600)

    # --- Fußzeile ---
    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'
    $fuss.Height = 56
    $fuss.BackColor = $global:Farbe.Flaeche
    $fussTrenner = New-Object System.Windows.Forms.Panel
    $fussTrenner.Dock = 'Top'; $fussTrenner.Height = 1; $fussTrenner.BackColor = $global:Farbe.Rahmen
    $fuss.Controls.Add($fussTrenner)

    $status = Neue-Beschriftung -Text '' -Klein
    $status.Location = New-Object System.Drawing.Point(16, 20)
    $fuss.Controls.Add($status)

    $knopfSpeichern = Neuer-Knopf -Text 'Speichern' -Breite 140 -Betont
    $knopfTesten    = Neuer-Knopf -Text 'Ausprobieren' -Breite 140
    $knopfWeiter    = Neuer-Knopf -Text 'Weitergeben …' -Breite 140
    $knopfSchliessen = Neuer-Knopf -Text 'Schließen' -Breite 120
    foreach ($k in @($knopfSpeichern, $knopfTesten, $knopfWeiter, $knopfSchliessen)) { $k.Anchor = 'Top,Right' }
    $fuss.Controls.AddRange(@($knopfSpeichern, $knopfTesten, $knopfWeiter, $knopfSchliessen))

    # --- Aufteilung ---
    $teiler = New-Object System.Windows.Forms.SplitContainer
    $teiler.Dock = 'Fill'
    $teiler.Orientation = 'Vertical'
    $teiler.SplitterWidth = 8

    # Links: Baum + Knöpfe
    $baum = New-Object System.Windows.Forms.TreeView
    $baum.Dock = 'Fill'
    $baum.HideSelection = $false
    $baum.BorderStyle = 'None'
    $baum.BackColor = $global:Farbe.Flaeche
    $baum.Font = $global:Schrift
    $baum.ItemHeight = 24
    $baum.ShowLines = $false
    # Ohne Wurzellinien zeigt Windows an den Kategorien kein Plus/Minus — dann
    # lassen sie sich nicht zuklappen.
    $baum.ShowRootLines = $true
    $baum.ShowPlusMinus = $true

    $baumLeiste = New-Object System.Windows.Forms.Panel
    $baumLeiste.Dock = 'Bottom'
    $baumLeiste.Height = 44
    $baumLeiste.BackColor = $global:Farbe.Hintergrund
    $knopfNeu     = Neuer-Knopf -Text 'Neu' -Breite 74 -Hoehe 30
    $knopfKopie   = Neuer-Knopf -Text 'Kopie' -Breite 74 -Hoehe 30
    $knopfLoeschen = Neuer-Knopf -Text 'Löschen' -Breite 90 -Hoehe 30
    $knopfNeu.Location     = New-Object System.Drawing.Point(4, 7)
    $knopfKopie.Location   = New-Object System.Drawing.Point(82, 7)
    $knopfLoeschen.Location = New-Object System.Drawing.Point(160, 7)
    $baumLeiste.Controls.AddRange(@($knopfNeu, $knopfKopie, $knopfLoeschen))

    # Alle Kategorien auf einen Schlag zu- oder aufklappen
    $baumKopf = New-Object System.Windows.Forms.Panel
    $baumKopf.Dock = 'Top'
    $baumKopf.Height = 30
    $baumKopf.BackColor = $global:Farbe.Hintergrund
    $knopfZu  = Neuer-Knopf -Text 'alle zuklappen' -Breite 118 -Hoehe 24
    $knopfAuf = Neuer-Knopf -Text 'alle aufklappen' -Breite 118 -Hoehe 24
    $knopfZu.Font = $global:SchriftKlein
    $knopfAuf.Font = $global:SchriftKlein
    $knopfZu.Location  = New-Object System.Drawing.Point(4, 3)
    $knopfAuf.Location = New-Object System.Drawing.Point(126, 3)
    $baumKopf.Controls.AddRange(@($knopfZu, $knopfAuf))

    $teiler.Panel1.Controls.Add($baum)
    $teiler.Panel1.Controls.Add($baumLeiste)
    $teiler.Panel1.Controls.Add($baumKopf)

    # Rechts: Kopfdaten
    $kopf = New-Object System.Windows.Forms.Panel
    $kopf.Dock = 'Top'
    $kopf.BackColor = $global:Farbe.Flaeche

    $lbName = Neue-Beschriftung -Text 'Name' -Fett
    $eName = Neues-Eingabefeld -Breite 400

    $lbKat = Neue-Beschriftung -Text 'Kategorie' -Fett
    $eKat = New-Object System.Windows.Forms.ComboBox
    $eKat.Width = 240
    $eKat.DropDownStyle = 'DropDown'      # frei beschreibbar, nicht nur auswählbar
    $hKat = Neue-Beschriftung -Text 'auswählen oder neue eintippen' -Klein

    $lbKuerzel = Neue-Beschriftung -Text 'Kürzel' -Fett
    $eKuerzel = Neues-Eingabefeld -Breite 120

    $lbBesch = Neue-Beschriftung -Text 'Wofür ist der Baustein?' -Fett
    $eBesch = Neues-Eingabefeld -Breite 300

    <#
        Eigene, dritte Zeile für die Kürzel-Erkennung: bewusst getrennt von der
        Zeile mit dem Such-Kürzel oben, weil es sich um zwei verschiedene Dinge
        handelt — das eine wird nur in der DocKit-eigenen Suche benutzt, das
        andere beim Tippen in jedem Programm mitgelesen (Abschnitt 3, sofern in
        den Einstellungen eingeschaltet).
    #>
    $lbAutotext = Neue-Beschriftung -Text 'Kürzel für die automatische Erkennung (optional)' -Fett
    $eAutotext = Neues-Eingabefeld -Breite 160
    $hAutotext = Neue-Beschriftung -Text '' -Klein
    $hAutotext.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $kopf.Controls.AddRange(@($lbName, $eName, $lbKat, $eKat, $hKat, $lbKuerzel, $eKuerzel, $lbBesch, $eBesch, $lbAutotext, $eAutotext, $hAutotext))

    # Zwei Zeilen: oben der Name über die volle Breite, darunter drei Felder nebeneinander.
    $spalteKuerzel = 268
    $spalteBesch   = 402
    $zeile1 = 10
    $lbName.Location = New-Object System.Drawing.Point(14, $zeile1)
    $eName.Location  = New-Object System.Drawing.Point(14, ($zeile1 + $lbName.PreferredHeight + 3))
    $zeile2 = $eName.Bottom + 12
    foreach ($spalte in @(@($lbKat, $eKat, 14), @($lbKuerzel, $eKuerzel, $spalteKuerzel), @($lbBesch, $eBesch, $spalteBesch))) {
        $spalte[0].Location = New-Object System.Drawing.Point($spalte[2], $zeile2)
        $spalte[1].Location = New-Object System.Drawing.Point($spalte[2], ($zeile2 + $spalte[0].PreferredHeight + 3))
    }
    $hKat.Location = New-Object System.Drawing.Point(14, ($eKat.Bottom + 3))

    $zeile3 = $hKat.Bottom + 12
    $lbAutotext.Location = New-Object System.Drawing.Point(14, $zeile3)
    $eAutotext.Location  = New-Object System.Drawing.Point(14, ($zeile3 + $lbAutotext.PreferredHeight + 3))
    $hAutotext.Location  = New-Object System.Drawing.Point(14, ($eAutotext.Bottom + 3))
    $kopf.Height = $hAutotext.Bottom + 12

    # Die beiden breiten Felder wachsen mit. Über Anchor allein ginge das schief,
    # weil ihre Ausgangsbreite größer ist als der Bereich beim Anlegen.
    $passeKopfAn = {
        $eName.Width  = [Math]::Max(220, $kopf.ClientSize.Width - 28)
        $eBesch.Width = [Math]::Max(160, $kopf.ClientSize.Width - $spalteBesch - 14)
    }.GetNewClosure()
    $kopf.Add_Resize($passeKopfAn)

    # Rechts unten: Text und Felder
    $unten = New-Object System.Windows.Forms.SplitContainer
    $unten.Dock = 'Fill'
    $unten.Orientation = 'Horizontal'
    $unten.SplitterWidth = 8

    $textRahmen = New-Object System.Windows.Forms.GroupBox
    $textRahmen.Text = ' Text des Bausteins '
    $textRahmen.Dock = 'Fill'
    $textRahmen.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 8)

    # --- Werkzeugleiste in zwei festen Reihen: oben die Formatierung, gruppiert
    #     und durch schmale Striche getrennt, unten die Platzhalter. ---
    $textLeiste = New-Object System.Windows.Forms.Panel
    $textLeiste.Dock = 'Top'

    $cbSchriftart = New-Object System.Windows.Forms.ComboBox
    $cbSchriftart.DropDownStyle = 'DropDownList'
    $cbSchriftart.Width = 148
    foreach ($fam in ([System.Drawing.Text.InstalledFontCollection]::new()).Families) {
        [void]$cbSchriftart.Items.Add($fam.Name)
    }

    $cbGroesse = New-Object System.Windows.Forms.ComboBox
    $cbGroesse.DropDownStyle = 'DropDown'
    $cbGroesse.Width = 56
    foreach ($g in @(8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28)) { [void]$cbGroesse.Items.Add($g) }

    $knopfFett   = Neuer-Knopf -Text 'F' -Breite 30 -Hoehe 25
    $knopfKursiv = Neuer-Knopf -Text 'K' -Breite 30 -Hoehe 25
    $knopfUnter  = Neuer-Knopf -Text 'U' -Breite 30 -Hoehe 25
    $knopfFett.Font   = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $knopfKursiv.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Italic)
    $knopfUnter.Font  = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Underline)

    $knopfLinks  = Neuer-Knopf -Text 'links'  -Breite 52 -Hoehe 25
    $knopfMitte  = Neuer-Knopf -Text 'mitte'  -Breite 52 -Hoehe 25
    $knopfRechts = Neuer-Knopf -Text 'rechts' -Breite 52 -Hoehe 25
    foreach ($k in @($knopfLinks, $knopfMitte, $knopfRechts)) { $k.Font = $global:SchriftKlein }

    $cbAbstand = New-Object System.Windows.Forms.ComboBox
    $cbAbstand.DropDownStyle = 'DropDownList'
    $cbAbstand.Width = 132   # "Zeilenabstand …" muss vollständig hineinpassen
    # Der erste Eintrag beschriftet die Liste. Den Istwert eines Absatzes meldet
    # Windows nicht verlässlich zurück — lieber eine Überschrift als eine Zahl,
    # die vielleicht gar nicht stimmt.
    foreach ($a in @('Zeilenabstand …', '1,0 Zeilen', '1,15 Zeilen', '1,5 Zeilen', '2,0 Zeilen')) { [void]$cbAbstand.Items.Add($a) }
    $cbAbstand.SelectedIndex = 0

    $knopfPlatzhalter = Neuer-Knopf -Text 'Platzhalter einfügen  ▾' -Breite 172 -Hoehe 25
    $knopfPlatzhalter.Font = $global:SchriftKlein

    $platzhalterHinweis = Neue-Beschriftung -Text 'Alles in geschweiften Klammern wird beim Einfügen ersetzt.' -Klein

    $hoeheReihe1 = Setze-Reihe $textLeiste @(
        $cbSchriftart, 6, $cbGroesse,
        12, (Neuer-Gruppentrenner), 12,
        $knopfFett, 3, $knopfKursiv, 3, $knopfUnter,
        12, (Neuer-Gruppentrenner), 12,
        $knopfLinks, 3, $knopfMitte, 3, $knopfRechts,
        12, (Neuer-Gruppentrenner), 12,
        $cbAbstand
    ) 0 0

    $hoeheReihe2 = Setze-Reihe $textLeiste @($knopfPlatzhalter, 12, $platzhalterHinweis) ($hoeheReihe1 + 7) 0
    $textLeiste.Height = $hoeheReihe1 + 7 + $hoeheReihe2 + 8

    $eText = New-Object System.Windows.Forms.RichTextBox
    $eText.Dock = 'Fill'
    $eText.BorderStyle = 'FixedSingle'
    $eText.AcceptsTab = $true
    $eText.HideSelection = $false
    $eText.DetectUrls = $false
    $eText.Font = Standard-Schrift

    <#
        Ein gedrückter Knopf bekommt eine graue Fläche und einen blauen Rand.
        Ohne das sieht man nicht, ob an der Cursorstelle gerade fett gilt.

        WICHTIG: Diese beiden Blöcke müssen NACH $eText stehen. Eine Closure fängt
        die Variablen beim Erzeugen ein — stünde sie davor, hielte sie ein leeres
        Textfeld fest, und die Knöpfe blieben immer weiß.
    #>
    $knopfZustand = {
        param($Knopf, [bool]$An)
        if ($An) {
            $Knopf.BackColor = [System.Drawing.Color]::FromArgb(198, 207, 219)
            $Knopf.FlatAppearance.BorderColor = $global:Farbe.Akzent
            $Knopf.FlatAppearance.BorderSize = 2
        } else {
            $Knopf.BackColor = $global:Farbe.Flaeche
            $Knopf.FlatAppearance.BorderColor = $global:Farbe.Rahmen
            $Knopf.FlatAppearance.BorderSize = 1
        }
    }

    # Liest ab, was an der Cursorstelle gilt, und stellt die Knöpfe entsprechend.
    $stilAnzeigen = {
        $f = $eText.SelectionFont
        & $knopfZustand $knopfFett   $(if ($f) { $f.Bold } else { $false })
        & $knopfZustand $knopfKursiv $(if ($f) { $f.Italic } else { $false })
        & $knopfZustand $knopfUnter  $(if ($f) { $f.Underline } else { $false })
        $wo = [string]$eText.SelectionAlignment
        & $knopfZustand $knopfLinks  ($wo -eq 'Left')
        & $knopfZustand $knopfMitte  ($wo -eq 'Center')
        & $knopfZustand $knopfRechts ($wo -eq 'Right')
    }.GetNewClosure()

    $textRahmen.Controls.Add($eText)
    $textRahmen.Controls.Add($textLeiste)
    $unten.Panel1.Controls.Add($textRahmen)

    $feldRahmen = New-Object System.Windows.Forms.GroupBox
    $feldRahmen.Text = ' Felder, die vor dem Einfügen abgefragt werden '
    $feldRahmen.Dock = 'Fill'
    $feldRahmen.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 8)

    $feldKnoepfe = New-Object System.Windows.Forms.Panel
    $feldKnoepfe.Dock = 'Right'
    $feldKnoepfe.Width = 140
    $kFeldNeu   = Neuer-Knopf -Text 'Neues Feld' -Breite 130 -Hoehe 30
    $kFeldHolen = Neuer-Knopf -Text 'Vorhandenes …' -Breite 130 -Hoehe 30
    $kFeldBearb = Neuer-Knopf -Text 'Bearbeiten' -Breite 130 -Hoehe 30
    $kFeldWeg   = Neuer-Knopf -Text 'Entfernen' -Breite 130 -Hoehe 30
    $kFeldHoch  = Neuer-Knopf -Text 'Nach oben' -Breite 130 -Hoehe 30
    $kFeldRunter = Neuer-Knopf -Text 'Nach unten' -Breite 130 -Hoehe 30
    $kFeldNeu.Location    = New-Object System.Drawing.Point(6, 2)
    $kFeldHolen.Location  = New-Object System.Drawing.Point(6, 34)
    $kFeldBearb.Location  = New-Object System.Drawing.Point(6, 70)
    $kFeldWeg.Location    = New-Object System.Drawing.Point(6, 102)
    $kFeldHoch.Location   = New-Object System.Drawing.Point(6, 140)
    $kFeldRunter.Location = New-Object System.Drawing.Point(6, 172)
    $feldKnoepfe.Controls.AddRange(@($kFeldNeu, $kFeldHolen, $kFeldBearb, $kFeldWeg, $kFeldHoch, $kFeldRunter))

    $feldListe = New-Object System.Windows.Forms.ListBox
    $feldListe.Dock = 'Fill'
    $feldListe.BorderStyle = 'FixedSingle'
    $feldListe.IntegralHeight = $false

    $feldRahmen.Controls.Add($feldListe)
    $feldRahmen.Controls.Add($feldKnoepfe)
    $unten.Panel2.Controls.Add($feldRahmen)

    $rechts = New-Object System.Windows.Forms.Panel
    $rechts.Dock = 'Fill'
    $rechts.Controls.Add($unten)
    $rechts.Controls.Add($kopf)
    $teiler.Panel2.Controls.Add($rechts)

    # --- Drei Reiter: Textbausteine, Vorlagen und Kombinationen ---
    $reiter = New-Object System.Windows.Forms.TabControl
    $reiter.Dock = 'Fill'
    $reiter.Padding = New-Object System.Drawing.Point(12, 5)

    $seiteBausteine = New-Object System.Windows.Forms.TabPage
    $seiteBausteine.Text = '  Textbausteine  '
    $seiteBausteine.BackColor = $global:Farbe.Hintergrund
    $seiteBausteine.Controls.Add($teiler)

    $seiteVorlagen = New-Object System.Windows.Forms.TabPage
    $seiteVorlagen.Text = '  Vorlagen  '
    $seiteVorlagen.BackColor = $global:Farbe.Hintergrund
    $seiteVorlagen.Padding = New-Object System.Windows.Forms.Padding(10)
    $seiteVorlagen.AllowDrop = $true

    # Ablagefläche für Dateien aus dem Explorer
    $ablage = New-Object System.Windows.Forms.Panel
    $ablage.Dock = 'Top'
    $ablage.Height = 84
    $ablage.BackColor = $global:Farbe.AkzentHell
    $ablage.AllowDrop = $true

    $ablageText = Neue-Beschriftung -Text 'Datei aus dem Explorer hierher ziehen' -Fett
    $ablageText.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
    $ablageText.ForeColor = $global:Farbe.Akzent
    $ablageHinweis = Neue-Beschriftung -Text 'Damit entsteht ein Verweis auf die Datei — die Datei selbst bleibt, wo sie ist.' -Klein
    $ablageText.Location    = New-Object System.Drawing.Point(20, 22)
    $ablageHinweis.Location = New-Object System.Drawing.Point(22, 50)
    $ablage.Controls.AddRange(@($ablageText, $ablageHinweis))

    $vorlagenListe = New-Object System.Windows.Forms.ListView
    $vorlagenListe.Dock = 'Fill'
    $vorlagenListe.View = 'Details'
    $vorlagenListe.FullRowSelect = $true
    $vorlagenListe.MultiSelect = $false
    $vorlagenListe.HideSelection = $false
    $vorlagenListe.HeaderStyle = 'Nonclickable'
    $vorlagenListe.BorderStyle = 'FixedSingle'
    $vorlagenListe.BackColor = $global:Farbe.Flaeche
    $vorlagenListe.AllowDrop = $true
    [void]$vorlagenListe.Columns.Add('Vorlage', 200)
    [void]$vorlagenListe.Columns.Add('Kategorie', 130)
    [void]$vorlagenListe.Columns.Add('Baustein landet', 190)
    [void]$vorlagenListe.Columns.Add('Datei', 430)

    $vorlagenKnoepfe = New-Object System.Windows.Forms.Panel
    $vorlagenKnoepfe.Dock = 'Right'
    $vorlagenKnoepfe.Width = 150
    $kVorlageNeu     = Neuer-Knopf -Text 'Datei hinzufügen' -Breite 140 -Hoehe 30
    $kVorlageVorschau = Neuer-Knopf -Text 'Vorschau' -Breite 140 -Hoehe 30
    $kVorlageBearb   = Neuer-Knopf -Text 'Bearbeiten' -Breite 140 -Hoehe 30
    $kVorlageWeg     = Neuer-Knopf -Text 'Entfernen' -Breite 140 -Hoehe 30
    $kVorlageTest    = Neuer-Knopf -Text 'Ausprobieren' -Breite 140 -Hoehe 30
    $kVorlageOrdner  = Neuer-Knopf -Text 'Ordner zeigen' -Breite 140 -Hoehe 30
    $kVorlageNeu.Location      = New-Object System.Drawing.Point(8, 2)
    $kVorlageVorschau.Location = New-Object System.Drawing.Point(8, 38)
    $kVorlageBearb.Location    = New-Object System.Drawing.Point(8, 74)
    $kVorlageWeg.Location      = New-Object System.Drawing.Point(8, 110)
    $kVorlageTest.Location     = New-Object System.Drawing.Point(8, 152)
    $kVorlageOrdner.Location   = New-Object System.Drawing.Point(8, 188)
    $vorlagenKnoepfe.Controls.AddRange(@($kVorlageNeu, $kVorlageVorschau, $kVorlageBearb, $kVorlageWeg, $kVorlageTest, $kVorlageOrdner))

    $seiteVorlagen.Controls.Add($vorlagenListe)
    $seiteVorlagen.Controls.Add($vorlagenKnoepfe)
    $seiteVorlagen.Controls.Add($ablage)
    $seiteKombinationen = New-Object System.Windows.Forms.TabPage
    $seiteKombinationen.Text = '  Kombinationen  '
    $seiteKombinationen.BackColor = $global:Farbe.Hintergrund
    $seiteKombinationen.Padding = New-Object System.Windows.Forms.Padding(10)

    # Erklärt, was eine Kombination ist — steht nur hier, sonst nirgends im Programm.
    $kombiHinweis = New-Object System.Windows.Forms.Panel
    $kombiHinweis.Dock = 'Top'
    $kombiHinweis.Height = 56
    $kombiHinweis.BackColor = $global:Farbe.AkzentHell
    $kombiHinweisText = Neue-Beschriftung -Text 'Verknüpft eine Vorlage mit einem Baustein unter einem eigenen Namen. Beim Benutzen entfällt dann die Nachfrage, welcher Baustein hinein soll.' -Klein
    $kombiHinweisText.ForeColor = $global:Farbe.Akzent
    $kombiHinweisText.MaximumSize = New-Object System.Drawing.Size(700, 0)
    $kombiHinweisText.Location = New-Object System.Drawing.Point(16, 12)
    $kombiHinweis.Controls.Add($kombiHinweisText)

    $kombinationenListe = New-Object System.Windows.Forms.ListView
    $kombinationenListe.Dock = 'Fill'
    $kombinationenListe.View = 'Details'
    $kombinationenListe.FullRowSelect = $true
    $kombinationenListe.MultiSelect = $false
    $kombinationenListe.HideSelection = $false
    $kombinationenListe.HeaderStyle = 'Nonclickable'
    $kombinationenListe.BorderStyle = 'FixedSingle'
    $kombinationenListe.BackColor = $global:Farbe.Flaeche
    [void]$kombinationenListe.Columns.Add('Kombination', 200)
    [void]$kombinationenListe.Columns.Add('Kategorie', 130)
    [void]$kombinationenListe.Columns.Add('Vorlage', 180)
    [void]$kombinationenListe.Columns.Add('Baustein', 220)

    $kombiKnoepfe = New-Object System.Windows.Forms.Panel
    $kombiKnoepfe.Dock = 'Right'
    $kombiKnoepfe.Width = 150
    $kKombiNeu   = Neuer-Knopf -Text 'Neu' -Breite 140 -Hoehe 30
    $kKombiBearb = Neuer-Knopf -Text 'Bearbeiten' -Breite 140 -Hoehe 30
    $kKombiWeg   = Neuer-Knopf -Text 'Entfernen' -Breite 140 -Hoehe 30
    $kKombiTest  = Neuer-Knopf -Text 'Ausprobieren' -Breite 140 -Hoehe 30
    $kKombiNeu.Location   = New-Object System.Drawing.Point(8, 2)
    $kKombiBearb.Location = New-Object System.Drawing.Point(8, 38)
    $kKombiWeg.Location   = New-Object System.Drawing.Point(8, 74)
    $kKombiTest.Location  = New-Object System.Drawing.Point(8, 116)
    $kombiKnoepfe.Controls.AddRange(@($kKombiNeu, $kKombiBearb, $kKombiWeg, $kKombiTest))

    $seiteKombinationen.Controls.Add($kombinationenListe)
    $seiteKombinationen.Controls.Add($kombiKnoepfe)
    $seiteKombinationen.Controls.Add($kombiHinweis)

    $reiter.TabPages.Add($seiteBausteine)
    $reiter.TabPages.Add($seiteVorlagen)
    $reiter.TabPages.Add($seiteKombinationen)

    $fenster.Controls.Add($reiter)
    $fenster.Controls.Add($fuss)

    # --- Arbeitsfunktionen -------------------------------------------------

    $setzeStatus = {
        param([string]$Text)
        $offen = if ($global:VerwaltungGeaendert) { '  •  ungespeicherte Änderungen' } else { '' }
        $wer = ''
        if ($global:AktuellerBaustein -and $global:AktuellerBaustein.PSObject.Properties['geaendert_von']) {
            $wer = "   |   zuletzt geändert von $($global:AktuellerBaustein.geaendert_von) am $($global:AktuellerBaustein.geaendert_am)"
        }
        if ($global:NurLesen) { $wer += '   |   Datei ist schreibgeschützt' }
        $status.Text = "$Text$offen$wer"
    }.GetNewClosure()

    $baueBaum = {
        param([string]$WaehleId)
        $baum.BeginUpdate()
        $baum.Nodes.Clear()
        $kategorien = @($global:Bausteine | ForEach-Object { if ([string]::IsNullOrWhiteSpace($_.kategorie)) { 'Ohne Kategorie' } else { [string]$_.kategorie } } | Sort-Object -Unique)
        $zielKnoten = $null
        foreach ($kat in $kategorien) {
            $knoten = $baum.Nodes.Add($kat)
            $knoten.NodeFont = $global:SchriftFett
            $knoten.ForeColor = $global:Farbe.Grau
            $passende = @($global:Bausteine | Where-Object {
                $k = if ([string]::IsNullOrWhiteSpace($_.kategorie)) { 'Ohne Kategorie' } else { [string]$_.kategorie }
                $k -eq $kat
            } | Sort-Object name)
            foreach ($b in $passende) {
                $kind = $knoten.Nodes.Add([string]$b.name)
                $kind.Tag = $b
                if ($b.id -eq $WaehleId) { $zielKnoten = $kind }
            }
            $knoten.Expand()
        }
        $baum.EndUpdate()
        if ($zielKnoten) { $baum.SelectedNode = $zielKnoten }

        # Beim Neubefüllen der Kategorienliste ändert sich kurzzeitig der Text des
        # Auswahlfelds. Ohne diese Sperre gälte der Baustein danach als bearbeitet.
        $vorherLaedt = $global:Laedt
        $global:Laedt = $true
        $gemerkteKategorie = $eKat.Text
        $eKat.Items.Clear()
        foreach ($kat in $kategorien) { [void]$eKat.Items.Add($kat) }
        $eKat.Text = $gemerkteKategorie
        $global:Laedt = $vorherLaedt

        & $setzeStatus "$(@($global:Bausteine).Count) Bausteine in $(@($kategorien).Count) Kategorien"
    }.GetNewClosure()

    $zeigeFelder = {
        $feldListe.Items.Clear()
        if ($null -eq $global:AktuellerBaustein) { return }
        foreach ($f in @($global:AktuellerBaustein.felder)) {
            $bezeichnung = if ($global:Feldtypen.Contains([string]$f.typ)) { $global:Feldtypen[[string]$f.typ] } else { [string]$f.typ }
            $zusatz = ''
            if ($null -ne $f.PSObject.Properties['zeigen_wenn_feld'] -and -not [string]::IsNullOrWhiteSpace($f.zeigen_wenn_feld)) {
                $zusatz = "   —   nur wenn {$($f.zeigen_wenn_feld)} = $($f.zeigen_wenn_wert)"
            }
            [void]$feldListe.Items.Add("{$($f.name)}   —   $bezeichnung$zusatz")
        }
    }.GetNewClosure()

    <#
        Zeigt, was das Kürzel bewirkt — und warnt, wenn ein anderer Baustein
        dasselbe Kürzel schon benutzt: Nur einer von beiden könnte dann je
        auslösen, und welcher, wäre reiner Zufall der Ladereihenfolge.

        Muss vor $zeigeBaustein stehen, das sie aufruft — .GetNewClosure()
        hält nur fest, was zum Zeitpunkt des Aufrufs schon eine Variable ist.
    #>
    $zeigeAutotextHinweis = {
        $wert = $eAutotext.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($wert)) {
            $hAutotext.Text = 'Wird dieses Kürzel getippt und mit Leerzeichen/Enter/Tab abgeschlossen, erscheint der Baustein sofort dort — in jedem Programm, sofern die Kürzel-Erkennung in den Einstellungen eingeschaltet ist.'
            $hAutotext.ForeColor = $global:Farbe.Grau
            return
        }
        $andere = @($global:Bausteine) | Where-Object {
            $_ -and $_ -ne $global:AktuellerBaustein -and [string]$_.autotext_kuerzel -eq $wert
        } | Select-Object -First 1
        if ($andere) {
            $hAutotext.Text = "Dieses Kürzel ist schon bei »$($andere.name)« vergeben — nur einer von beiden würde auslösen."
            $hAutotext.ForeColor = $global:Farbe.Warnung
        } else {
            $hAutotext.Text = 'Wird dieses Kürzel getippt und mit Leerzeichen/Enter/Tab abgeschlossen, erscheint der Baustein sofort dort — in jedem Programm, sofern die Kürzel-Erkennung in den Einstellungen eingeschaltet ist.'
            $hAutotext.ForeColor = $global:Farbe.Grau
        }
    }.GetNewClosure()

    $zeigeBaustein = {
        $global:Laedt = $true
        $b = $global:AktuellerBaustein
        $anAus = ($null -ne $b)
        foreach ($c in @($eName, $eKat, $eKuerzel, $eBesch, $eAutotext, $eText, $feldListe, $knopfPlatzhalter, $kFeldNeu, $kFeldBearb, $kFeldWeg, $kFeldHoch, $kFeldRunter)) {
            $c.Enabled = $anAus
        }
        if ($anAus) {
            $eName.Text    = [string]$b.name
            $eKat.Text     = [string]$b.kategorie
            $eKuerzel.Text = [string]$b.kuerzel
            $eBesch.Text   = [string]$b.beschreibung
            $eAutotext.Text = [string]$b.autotext_kuerzel
            try { $eText.Rtf = Hole-Baustein-Rtf $b } catch { $eText.Text = [string]$b.text }
            # Leiste auf das stellen, was am Textanfang gilt
            $eText.Select(0, [Math]::Min(1, $eText.TextLength))
            $f0 = $eText.SelectionFont
            if ($null -eq $f0) { $f0 = $eText.Font }
            $cbSchriftart.SelectedItem = $f0.Name
            $cbGroesse.Text = ([string][Math]::Round($f0.Size, 1)) -replace '\.', ','
            $eText.Select(0, 0)
            $cbAbstand.SelectedIndex = 0
        } else {
            $eName.Text = ''; $eKat.Text = ''; $eKuerzel.Text = ''; $eBesch.Text = ''; $eAutotext.Text = ''; $eText.Text = ''
            $cbSchriftart.SelectedIndex = -1
            $cbGroesse.Text = ''
            $cbAbstand.SelectedIndex = 0
        }
        & $zeigeFelder
        $global:Laedt = $false
        & $stilAnzeigen
        & $zeigeAutotextHinweis
    }.GetNewClosure()

    $merkeAenderung = {
        if ($global:Laedt -or $null -eq $global:AktuellerBaustein) { return }
        $b = $global:AktuellerBaustein
        $b.name         = $eName.Text
        $b.kategorie    = $eKat.Text
        $b.kuerzel      = $eKuerzel.Text
        $b.beschreibung = $eBesch.Text
        $b.autotext_kuerzel = $eAutotext.Text.Trim()
        $b.text         = $eText.Text
        $b.rtf          = $eText.Rtf
        # Wer hat zuletzt angefasst? In einer gemeinsam gepflegten Datei zählt das.
        if ($null -ne $b.PSObject.Properties['geaendert_von']) {
            $b.geaendert_von = $env:USERNAME
            $b.geaendert_am  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        }
        if ($baum.SelectedNode -and $baum.SelectedNode.Tag) { $baum.SelectedNode.Text = $eName.Text }
        Aktualisiere-Autotext-Kuerzel
        & $zeigeAutotextHinweis
        $global:VerwaltungGeaendert = $true
        & $setzeStatus 'Bearbeitet'
    }.GetNewClosure()

    # --- Ereignisse --------------------------------------------------------

    $baum.Add_AfterSelect({
        param($absender, $e)
        $global:AktuellerBaustein = $e.Node.Tag
        & $zeigeBaustein
    }.GetNewClosure())

    foreach ($c in @($eName, $eKuerzel, $eBesch, $eAutotext, $eText)) { $c.Add_TextChanged($merkeAenderung) }
    $eKat.Add_TextChanged($merkeAenderung)

    # --- Reiter "Vorlagen" ------------------------------------------------------

    $zeigeVorlagen = {
        $vorlagenListe.BeginUpdate()
        $vorlagenListe.Items.Clear()
        foreach ($v in @(@($global:Vorlagen) | Where-Object { $_ } | Sort-Object @{ Expression = { [string]$_.kategorie } }, @{ Expression = { [string]$_.name } })) {
            # @($null) liefert einen Eintrag, der $null ist — ohne diese Prüfung
            # bricht der Aufbau des Fensters hier ab, und zwar lautlos.
            if ($null -eq $v) { continue }
            $wohin = switch ([string]$v.einfuegen_art) {
                'textmarke' { "Textmarke »$($v.einfuegen_marke)«" }
                'ende'      { 'am Ende des Dokuments' }
                'keine'     { '— nur kopieren —' }
                default     { "Marke $($v.einfuegen_marke)" }
            }
            $e = New-Object System.Windows.Forms.ListViewItem([string]$v.name)
            [void]$e.SubItems.Add($(if ($v.kategorie) { [string]$v.kategorie } else { 'Vorlagen' }))
            [void]$e.SubItems.Add($wohin)
            [void]$e.SubItems.Add([string]$v.pfad)
            if (-not (Test-Path -LiteralPath ([string]$v.pfad))) {
                $e.ForeColor = $global:Farbe.Warnung
                $e.SubItems[3].Text = 'nicht erreichbar — ' + $v.pfad
            }
            $e.Tag = $v
            [void]$vorlagenListe.Items.Add($e)
        }
        $vorlagenListe.EndUpdate()
    }.GetNewClosure()

    $nimmDateien = {
        param($Pfade)
        $neu = 0
        foreach ($p in @($Pfade)) {
            if ([string]::IsNullOrWhiteSpace($p)) { continue }
            if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
            [void]$global:Vorlagen.Add((Neue-Vorlage $p))
            $neu++
        }
        if ($neu -gt 0) {
            $global:VerwaltungGeaendert = $true
            & $zeigeVorlagen
            $vorlagenListe.Items[$vorlagenListe.Items.Count - 1].Selected = $true
            & $setzeStatus "$neu Vorlage(n) hinzugefügt"
        }
    }.GetNewClosure()

    $zieheUeber = {
        param($absender, $e)
        if ($e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { $e.Effect = 'Copy' }
        else { $e.Effect = 'None' }
    }

    $lasseFallen = {
        param($absender, $e)
        if (-not $e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { return }
        & $nimmDateien ($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
    }.GetNewClosure()

    foreach ($ziel in @($seiteVorlagen, $ablage, $vorlagenListe)) {
        $ziel.Add_DragEnter($zieheUeber)
        $ziel.Add_DragOver($zieheUeber)
        $ziel.Add_DragDrop($lasseFallen)
    }

    $gewaehlteVorlage = {
        if ($vorlagenListe.SelectedItems.Count -eq 0) { return $null }
        return $vorlagenListe.SelectedItems[0].Tag
    }.GetNewClosure()

    $kVorlageVorschau.Add_Click({
        $v = & $gewaehlteVorlage
        if ($null -eq $v) { return }
        Zeige-Vorlage-Vorschau $v
    }.GetNewClosure())

    $kVorlageNeu.Add_Click({
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Title = 'Vorlagendateien wählen'
        $d.Filter = 'Alle Dateien (*.*)|*.*'
        $d.Multiselect = $true
        if ($d.ShowDialog() -eq 'OK') { & $nimmDateien $d.FileNames }
    }.GetNewClosure())

    $bearbeiteVorlage = {
        $v = & $gewaehlteVorlage
        if ($null -eq $v) { return }
        if (Zeige-Vorlageneditor -Vorlage $v) {
            $global:VerwaltungGeaendert = $true
            & $zeigeVorlagen
            & $setzeStatus 'Vorlage bearbeitet'
        }
    }.GetNewClosure()

    $kVorlageBearb.Add_Click($bearbeiteVorlage)
    $vorlagenListe.Add_DoubleClick($bearbeiteVorlage)

    # Auch von hier aus lässt sich eine Vorlage in einen Explorer-Ordner ziehen.
    $vorlagenListe.Add_ItemDrag({
        param($absender, $e)
        $v = $e.Item.Tag
        if ($null -eq $v) { return }
        Ziehe-Vorlage-Heraus -Steuerelement $vorlagenListe -Vorlage $v
    }.GetNewClosure())

    $kVorlageWeg.Add_Click({
        $v = & $gewaehlteVorlage
        if ($null -eq $v) { return }
        if (-not (Frage-Ja-Nein "Die Vorlage »$($v.name)« aus der Liste entfernen?`r`n`r`nDie Datei selbst bleibt unangetastet." 'Vorlage entfernen')) { return }
        $global:Vorlagen.Remove($v)
        $global:VerwaltungGeaendert = $true
        & $zeigeVorlagen
        & $setzeStatus 'Vorlage entfernt'
    }.GetNewClosure())

    $kVorlageTest.Add_Click({
        $v = & $gewaehlteVorlage
        if ($null -eq $v) { return }
        Benutze-Vorlage $v
    }.GetNewClosure())

    $kVorlageOrdner.Add_Click({
        $v = & $gewaehlteVorlage
        if ($null -eq $v) { return }
        Vorlage-Ordner-Zeigen $v
    }.GetNewClosure())

    # Sobald das Kategoriefeld verlassen wird, den Baum neu aufbauen: der Baustein
    # wandert dann sichtbar in seine — womöglich gerade erfundene — Kategorie.
    $eKat.Add_Leave({
        if ($global:Laedt -or $null -eq $global:AktuellerBaustein) { return }
        & $baueBaum $global:AktuellerBaustein.id
    }.GetNewClosure())
    # --- Reiter "Kombinationen" -------------------------------------------------

    $zeigeKombinationen = {
        $kombinationenListe.BeginUpdate()
        $kombinationenListe.Items.Clear()
        foreach ($k in @(@($global:Kombinationen) | Where-Object { $_ } | Sort-Object @{ Expression = { [string]$_.kategorie } }, @{ Expression = { [string]$_.name } })) {
            if ($null -eq $k) { continue }
            $kVorlage = @($global:Vorlagen) | Where-Object { $_ -and $_.id -eq $k.vorlage_id } | Select-Object -First 1
            $namen = Kombination-Bausteinnamen $k
            $e = New-Object System.Windows.Forms.ListViewItem([string]$k.name)
            [void]$e.SubItems.Add($(if ($k.kategorie) { [string]$k.kategorie } else { 'Allgemein' }))
            [void]$e.SubItems.Add($(if ($kVorlage) { [string]$kVorlage.name } else { '— fehlt —' }))
            [void]$e.SubItems.Add($namen.Text)
            if ($null -eq $kVorlage -or -not $namen.Vollstaendig) { $e.ForeColor = $global:Farbe.Warnung }
            $e.Tag = $k
            [void]$kombinationenListe.Items.Add($e)
        }
        $kombinationenListe.EndUpdate()
    }.GetNewClosure()

    $gewaehlteKombination = {
        if ($kombinationenListe.SelectedItems.Count -eq 0) { return $null }
        return $kombinationenListe.SelectedItems[0].Tag
    }.GetNewClosure()

    $kKombiNeu.Add_Click({
        if (@($global:Vorlagen).Count -eq 0 -or @($global:Bausteine).Count -eq 0) {
            Zeige-Meldung 'Für eine Kombination werden mindestens eine Vorlage und ein Baustein gebraucht — erst dort etwas anlegen.' 'Noch nichts zum Verknüpfen' 'Warning'
            return
        }
        $k = Neue-Kombination
        if (Zeige-Kombinationseditor -Kombination $k) {
            [void]$global:Kombinationen.Add($k)
            $global:VerwaltungGeaendert = $true
            & $zeigeKombinationen
            & $setzeStatus 'Kombination angelegt'
        }
    }.GetNewClosure())

    $bearbeiteKombination = {
        $k = & $gewaehlteKombination
        if ($null -eq $k) { return }
        if (Zeige-Kombinationseditor -Kombination $k) {
            $global:VerwaltungGeaendert = $true
            & $zeigeKombinationen
            & $setzeStatus 'Kombination bearbeitet'
        }
    }.GetNewClosure()
    $kKombiBearb.Add_Click($bearbeiteKombination)
    $kombinationenListe.Add_DoubleClick($bearbeiteKombination)

    # Auch von hier aus lässt sich eine Kombination in einen Explorer-Ordner ziehen.
    $kombinationenListe.Add_ItemDrag({
        param($absender, $e)
        $k = $e.Item.Tag
        if ($null -eq $k) { return }
        Ziehe-Kombination-Heraus -Steuerelement $kombinationenListe -Kombination $k
    }.GetNewClosure())

    $kKombiWeg.Add_Click({
        $k = & $gewaehlteKombination
        if ($null -eq $k) { return }
        if (-not (Frage-Ja-Nein "Die Kombination »$($k.name)« entfernen?`r`n`r`nDie Vorlage und der Baustein selbst bleiben erhalten." 'Kombination entfernen')) { return }
        $global:Kombinationen.Remove($k)
        $global:VerwaltungGeaendert = $true
        & $zeigeKombinationen
        & $setzeStatus 'Kombination entfernt'
    }.GetNewClosure())

    $kKombiTest.Add_Click({
        $k = & $gewaehlteKombination
        if ($null -eq $k) { return }
        Benutze-Kombination $k
    }.GetNewClosure())

    # --- Formatierung ---------------------------------------------------------

    # Reine Formatwechsel lösen kein TextChanged aus; deshalb wird nach jedem
    # Eingriff ausdrücklich gemerkt, dass sich der Baustein geändert hat.

    $stilUmschalten = {
        param([System.Drawing.FontStyle]$Stil)
        $f = $eText.SelectionFont
        if ($null -eq $f) { $f = $eText.Font }          # gemischte Auswahl
        $neu = if ($f.Style -band $Stil) { $f.Style -bxor $Stil } else { $f.Style -bor $Stil }
        $eText.SelectionFont = New-Object System.Drawing.Font($f.FontFamily, $f.Size, $neu)
        & $merkeAenderung
        & $stilAnzeigen
        [void]$eText.Focus()
    }.GetNewClosure()

    $knopfFett.Add_Click({   & $stilUmschalten ([System.Drawing.FontStyle]::Bold) }.GetNewClosure())
    $knopfKursiv.Add_Click({ & $stilUmschalten ([System.Drawing.FontStyle]::Italic) }.GetNewClosure())
    $knopfUnter.Add_Click({  & $stilUmschalten ([System.Drawing.FontStyle]::Underline) }.GetNewClosure())

    $knopfLinks.Add_Click({  $eText.SelectionAlignment = 'Left';   & $merkeAenderung; & $stilAnzeigen; [void]$eText.Focus() }.GetNewClosure())
    $knopfMitte.Add_Click({  $eText.SelectionAlignment = 'Center'; & $merkeAenderung; & $stilAnzeigen; [void]$eText.Focus() }.GetNewClosure())
    $knopfRechts.Add_Click({ $eText.SelectionAlignment = 'Right';  & $merkeAenderung; & $stilAnzeigen; [void]$eText.Focus() }.GetNewClosure())

    $cbSchriftart.Add_SelectedIndexChanged({
        if ($global:Laedt -or $null -eq $cbSchriftart.SelectedItem) { return }
        $f = $eText.SelectionFont
        if ($null -eq $f) { $f = $eText.Font }
        try { $eText.SelectionFont = New-Object System.Drawing.Font([string]$cbSchriftart.SelectedItem, $f.Size, $f.Style) } catch { }
        & $merkeAenderung
        [void]$eText.Focus()
    }.GetNewClosure())

    $groesseAnwenden = {
        if ($global:Laedt) { return }
        $wert = 0.0
        if (-not [double]::TryParse(($cbGroesse.Text -replace ',', '.'),
                [System.Globalization.NumberStyles]::Float,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$wert)) { return }
        if ($wert -lt 5 -or $wert -gt 200) { return }
        $f = $eText.SelectionFont
        if ($null -eq $f) { $f = $eText.Font }
        try { $eText.SelectionFont = New-Object System.Drawing.Font($f.FontFamily, [float]$wert, $f.Style) } catch { }
        & $merkeAenderung
    }.GetNewClosure()

    $cbGroesse.Add_SelectedIndexChanged($groesseAnwenden)
    $cbGroesse.Add_Leave($groesseAnwenden)

    $cbAbstand.Add_SelectedIndexChanged({
        if ($global:Laedt -or $cbAbstand.SelectedIndex -le 0) { return }   # 0 ist die Überschrift
        $zahl = ([string]$cbAbstand.SelectedItem -replace '[^0-9,]', '') -replace ',', '.'
        $wert = 1.5
        [void][double]::TryParse($zahl, [System.Globalization.NumberStyles]::Float,
            [System.Globalization.CultureInfo]::InvariantCulture, [ref]$wert)
        Setze-Absatzformat $eText $wert
        & $merkeAenderung
        [void]$eText.Focus()
    }.GetNewClosure())

    # Die Leiste zeigt, was an der Cursorstelle gilt.
    $eText.Add_SelectionChanged({
        if ($global:Laedt) { return }
        $global:Laedt = $true
        $f = $eText.SelectionFont
        if ($f) {
            $cbSchriftart.SelectedItem = $f.Name
            $cbGroesse.Text = ([string]([Math]::Round($f.Size, 1))) -replace '\.', ','
        }
        $global:Laedt = $false
        & $stilAnzeigen
    }.GetNewClosure())

    $knopfZu.Add_Click({ $baum.CollapseAll() }.GetNewClosure())
    $knopfAuf.Add_Click({ $baum.ExpandAll() }.GetNewClosure())

    $knopfNeu.Add_Click({
        $kat = if ($eKat.Text) { $eKat.Text } elseif ($baum.SelectedNode) { $baum.SelectedNode.Text } else { 'Allgemein' }
        $neu = Neuer-Baustein -Kategorie $kat
        [void]$global:Bausteine.Add($neu)
        $global:VerwaltungGeaendert = $true
        & $baueBaum $neu.id
        [void]$eName.Focus()
        $eName.SelectAll()
    }.GetNewClosure())

    $knopfKopie.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        $kopie = Vervollstaendige-Baustein ($global:AktuellerBaustein | ConvertTo-Json -Depth 12 | ConvertFrom-Json)
        $kopie.id = [guid]::NewGuid().ToString()
        $kopie.name = "$($kopie.name) (Kopie)"
        [void]$global:Bausteine.Add($kopie)
        $global:VerwaltungGeaendert = $true
        & $baueBaum $kopie.id
    }.GetNewClosure())

    $knopfLoeschen.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        if (-not (Frage-Ja-Nein "Den Baustein »$($global:AktuellerBaustein.name)« wirklich löschen?" 'Löschen')) { return }
        $global:Bausteine.Remove($global:AktuellerBaustein)
        $global:AktuellerBaustein = $null
        $global:VerwaltungGeaendert = $true
        & $baueBaum ''
        & $zeigeBaustein
    }.GetNewClosure())

    $knopfPlatzhalter.Add_Click({
        $namen = @()
        if ($global:AktuellerBaustein) {
            $namen = @(@($global:AktuellerBaustein.felder) | ForEach-Object { [string]$_.name })
        }
        Zeige-Platzhaltermenue $knopfPlatzhalter $eText $namen
    }.GetNewClosure())

    $kFeldNeu.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        $feld = Neues-Feld
        if (Zeige-Feldeditor -Feld $feld -Geschwister $global:AktuellerBaustein.felder) {
            [void]$global:AktuellerBaustein.felder.Add($feld)
            $global:VerwaltungGeaendert = $true
            & $zeigeFelder
            $feldListe.SelectedIndex = $feldListe.Items.Count - 1
            if (Frage-Ja-Nein "Soll {$($feld.name)} gleich an der Cursorstelle in den Text eingefügt werden?" 'Platzhalter einfügen') {
                $marke = "{$($feld.name)}"
                $pos = $eText.SelectionStart
                $eText.Text = $eText.Text.Insert($pos, $marke)
                $eText.SelectionStart = $pos + $marke.Length
                [void]$eText.Focus()
            }
        }
    }.GetNewClosure())

    <#
        Ein einmal gebautes Feld in einen anderen Baustein holen. Es wird kopiert,
        nicht verknüpft — sonst änderte eine Anpassung ungewollt fremde Bausteine.
    #>
    $kFeldHolen.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        $feld = Waehle-Vorhandenes-Feld -Baustein $global:AktuellerBaustein
        if ($null -eq $feld) { return }
        [void]$global:AktuellerBaustein.felder.Add($feld)
        $global:VerwaltungGeaendert = $true
        & $zeigeFelder
        $feldListe.SelectedIndex = $feldListe.Items.Count - 1
        if (Frage-Ja-Nein "Soll {$($feld.name)} gleich an der Cursorstelle in den Text eingefügt werden?" 'Platzhalter einfügen') {
            $marke = "{$($feld.name)}"
            $pos = $eText.SelectionStart
            $eText.SelectedText = $marke
            [void]$eText.Focus()
        }
        & $setzeStatus "Feld {$($feld.name)} übernommen"
    }.GetNewClosure())

    $bearbeiteFeld = {
        if ($null -eq $global:AktuellerBaustein) { return }
        $i = $feldListe.SelectedIndex
        if ($i -lt 0) { return }
        $feld = $global:AktuellerBaustein.felder[$i]
        $alterName = [string]$feld.name
        if (Zeige-Feldeditor -Feld $feld -Geschwister $global:AktuellerBaustein.felder) {
            if ($alterName -ne $feld.name -and $eText.Text -like "*{$alterName}*") {
                if (Frage-Ja-Nein "Das Feld heißt jetzt anders. Soll {$alterName} im Text durch {$($feld.name)} ersetzt werden?" 'Umbenennen') {
                    $eText.Text = $eText.Text.Replace("{$alterName}", "{$($feld.name)}")
                }
            }
            $global:VerwaltungGeaendert = $true
            & $zeigeFelder
            $feldListe.SelectedIndex = $i
        }
    }.GetNewClosure()

    $kFeldBearb.Add_Click($bearbeiteFeld)
    $feldListe.Add_DoubleClick($bearbeiteFeld)

    $kFeldWeg.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        $i = $feldListe.SelectedIndex
        if ($i -lt 0) { return }
        $feld = $global:AktuellerBaustein.felder[$i]
        if (-not (Frage-Ja-Nein "Das Feld »$($feld.name)« entfernen? Der Platzhalter im Text bleibt stehen." 'Feld entfernen')) { return }
        $global:AktuellerBaustein.felder.RemoveAt($i)
        $global:VerwaltungGeaendert = $true
        & $zeigeFelder
    }.GetNewClosure())

    $verschiebe = {
        param([int]$Richtung)
        if ($null -eq $global:AktuellerBaustein) { return }
        $i = $feldListe.SelectedIndex
        $neu = $i + $Richtung
        if ($i -lt 0 -or $neu -lt 0 -or $neu -ge $global:AktuellerBaustein.felder.Count) { return }
        $feld = $global:AktuellerBaustein.felder[$i]
        $global:AktuellerBaustein.felder.RemoveAt($i)
        $global:AktuellerBaustein.felder.Insert($neu, $feld)
        $global:VerwaltungGeaendert = $true
        & $zeigeFelder
        $feldListe.SelectedIndex = $neu
    }.GetNewClosure()

    $kFeldHoch.Add_Click({ & $verschiebe -1 }.GetNewClosure())
    $kFeldRunter.Add_Click({ & $verschiebe 1 }.GetNewClosure())

    $knopfTesten.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        $fehlende = New-Object System.Collections.ArrayList
        $bekannt = @(@($global:AktuellerBaustein.felder | ForEach-Object { [string]$_.name })) +
                   @('heute', 'uhrzeit', 'jahr', 'monat', 'tag', 'benutzer', 'computer', 'zwischenablage')
        foreach ($p in (Finde-Platzhalter $global:AktuellerBaustein.text)) {
            if ($bekannt -notcontains $p) { [void]$fehlende.Add($p) }
        }
        if ($fehlende.Count -gt 0) {
            Zeige-Meldung ("Für diese Platzhalter gibt es kein Feld — sie bleiben im Text stehen:`r`n`r`n  {" + ($fehlende -join '}, {') + "}") 'Hinweis' 'Warning'
        }
        [void](Zeige-Assistent -Baustein $global:AktuellerBaustein -NurVorschau)
    }.GetNewClosure())

    <#
        Weitergeben gibt den Stand weiter, der gerade im Fenster steht —
        deshalb wird vorher gespeichert, sonst bekäme der Kollege die alte Fassung.
    #>
    $knopfWeiter.Add_Click({
        if ($null -eq $global:AktuellerBaustein) { return }
        if ($global:VerwaltungGeaendert) {
            if (-not (Frage-Ja-Nein 'Es gibt noch ungespeicherte Änderungen. Vor dem Weitergeben speichern?' 'Weitergeben')) { return }
            $knopfSpeichern.PerformClick()
        }
        Zeige-Weitergabe @($global:AktuellerBaustein)
    }.GetNewClosure())

    <#
        Rückmeldung beim Speichern: Der Knopf selbst quittiert für zwei Sekunden
        grün. Ohne das passiert scheinbar gar nichts — die Statuszeile unten links
        wird leicht übersehen.
    #>
    $quittung = New-Object System.Windows.Forms.Timer
    $quittung.Interval = 2000
    $quittung.Add_Tick({
        $quittung.Stop()
        $knopfSpeichern.Text = 'Speichern'
        $knopfSpeichern.BackColor = $global:Farbe.Akzent
        $knopfSpeichern.FlatAppearance.BorderColor = $global:Farbe.Akzent
    }.GetNewClosure())

    $knopfSpeichern.Add_Click({
        if ($global:NurLesen) {
            Zeige-Meldung ("Diese Textbausteindatei ist schreibgeschützt:`r`n`r`n$($global:BausteinDatei)`r`n`r`n" +
                'Änderungen lassen sich hier nicht sichern. Über das Symbolmenü kannst du eine eigene Datei anlegen.') 'Nur lesen' 'Warning'
            return
        }
        try {
            Speichere-Bausteine
        } catch {
            Zeige-Meldung ("Das Speichern ist fehlgeschlagen:`r`n`r`n$($_.Exception.Message)`r`n`r`n" +
                "Datei: $($global:BausteinDatei)`r`n`r`nLiegt sie auf einem schreibgeschützten Laufwerk?") 'Nicht gespeichert' 'Error'
            return
        }
        $global:VerwaltungGeaendert = $false
        $gruen = [System.Drawing.Color]::FromArgb(21, 110, 71)
        $knopfSpeichern.Text = '✓  Gespeichert'
        $knopfSpeichern.BackColor = $gruen
        $knopfSpeichern.FlatAppearance.BorderColor = $gruen
        & $setzeStatus "Gespeichert um $(Get-Date -Format 'HH:mm:ss') in $(Dateiname-Kurz $global:BausteinDatei)"
        $quittung.Stop(); $quittung.Start()
    }.GetNewClosure())

    $knopfSchliessen.Add_Click({ $fenster.Close() }.GetNewClosure())

    $fenster.Add_FormClosing({
        param($absender, $e)
        if ($global:VerwaltungGeaendert) {
            $antwort = [System.Windows.Forms.MessageBox]::Show(
                'Es gibt ungespeicherte Änderungen. Jetzt speichern?',
                'DocKit', 'YesNoCancel', 'Question')
            if ($antwort -eq 'Yes') { Speichere-Bausteine; $global:VerwaltungGeaendert = $false }
            elseif ($antwort -eq 'Cancel') { $e.Cancel = $true; return }
            else { $global:Bausteine = Lade-Bausteine }
        }
    }.GetNewClosure())

    $fuss.Add_Resize({
        $knopfSchliessen.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfSchliessen.Width), 11)
        $knopfSpeichern.Location  = New-Object System.Drawing.Point(($knopfSchliessen.Left - 10 - $knopfSpeichern.Width), 11)
        $knopfTesten.Location     = New-Object System.Drawing.Point(($knopfSpeichern.Left - 10 - $knopfTesten.Width), 11)
        $knopfWeiter.Location     = New-Object System.Drawing.Point(($knopfTesten.Left - 10 - $knopfWeiter.Width), 11)
    }.GetNewClosure())

    $fenster.Add_Shown({
        $teiler.SplitterDistance = 300
        # Erst hier: vorher hat der Teiler noch keine Größe und lehnt die Vorgabe ab.
        # Sechs Knöpfe à 30 Pixel plus Abstände und der Gruppenrahmen ringsum:
        # unter 248 Pixel fallen die letzten Knöpfe unter den Fensterrand.
        $unten.Panel2MinSize = 248
        # Der Text bekommt den größeren Teil — dort wird gearbeitet.
        $unten.SplitterDistance = [Math]::Max(120, [Math]::Min([int]($unten.ClientSize.Height * 0.72), ($unten.ClientSize.Height - $unten.Panel2MinSize - $unten.SplitterWidth)))
        $knopfSchliessen.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfSchliessen.Width), 11)
        $knopfSpeichern.Location  = New-Object System.Drawing.Point(($knopfSchliessen.Left - 10 - $knopfSpeichern.Width), 11)
        $knopfTesten.Location     = New-Object System.Drawing.Point(($knopfSpeichern.Left - 10 - $knopfTesten.Width), 11)
        $knopfWeiter.Location     = New-Object System.Drawing.Point(($knopfTesten.Left - 10 - $knopfWeiter.Width), 11)
        & $passeKopfAn
        & $baueBaum ''
        & $zeigeBaustein
        & $zeigeVorlagen
        & $zeigeKombinationen
        if ($baum.Nodes.Count -gt 0 -and $baum.Nodes[0].Nodes.Count -gt 0) { $baum.SelectedNode = $baum.Nodes[0].Nodes[0] }
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    $global:VerwaltungOffen = $false
}



<#
    --- Weitergeben: das Fenster ---

    Drei Wege hinaus, je nachdem, wo der Baustein hinsoll:
      • als Datei speichern — für ein Laufwerk oder zum späteren Anhängen
      • in die Zwischenablage — in Outlook mit Strg+V direkt an die Mail geheftet
      • in eine andere Textbausteindatei — etwa die der Dienststelle

    Der vierte Weg braucht kein Fenster: den Baustein aus der Übersicht heraus
    in einen Ordner oder in ein offenes Mailfenster ziehen.
#>
function Zeige-Weitergabe {
    param($Bausteine)

    $liste = @($Bausteine)
    if ($liste.Count -eq 0) { return }

    $titel = if ($liste.Count -eq 1) { 'Baustein weitergeben' } else { "$($liste.Count) Bausteine weitergeben" }
    $fenster = Neues-Fenster -Titel $titel -Breite 620 -Hoehe 420 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false; $fenster.MinimizeBox = $false
    $fenster.TopMost = $true

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $was = if ($liste.Count -eq 1) { "»$($liste[0].name)«" } else { "$($liste.Count) Bausteine" }
    $kopf = Neue-Beschriftung -Text "$was weitergeben"
    $kopf.Font = $global:SchriftTitel

    # Bei einem einzigen Baustein steht der Name schon in der Überschrift.
    $namen = if ($liste.Count -eq 1) { 'Wohin soll er?' } else { (@($liste | ForEach-Object { $_.name }) -join ', ') }
    if ($namen.Length -gt 220) { $namen = $namen.Substring(0, 220) + ' …' }
    $wer = Neue-Beschriftung -Text $namen -Klein
    $wer.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $kDatei  = Neuer-Knopf -Text 'Als Datei speichern …'   -Breite 280 -Hoehe 38 -Betont
    $hDatei  = Neue-Beschriftung -Text "Legt eine $($global:WeitergabeEndung)-Datei ab, die sich an eine Mail hängen lässt." -Klein
    $kAblage = Neuer-Knopf -Text 'In die Zwischenablage'    -Breite 280 -Hoehe 38
    $hAblage = Neue-Beschriftung -Text 'Danach in der Mail Strg+V drücken — die Datei hängt dann als Anlage daran.' -Klein
    $hAblage.MaximumSize = New-Object System.Drawing.Size(560, 0)
    $kAndere = Neuer-Knopf -Text 'In eine andere Datei schreiben …' -Breite 280 -Hoehe 38
    $hAndere = Neue-Beschriftung -Text 'Schreibt sie in eine andere Textbausteindatei, etwa die der Dienststelle. Die gerade geöffnete bleibt unverändert.' -Klein
    $hAndere.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $lGleich = Neue-Beschriftung -Text 'Gibt es dort schon einen Baustein mit demselben Namen:' -Klein
    $cbGleich = New-Object System.Windows.Forms.ComboBox
    $cbGleich.DropDownStyle = 'DropDownList'
    $cbGleich.Width = 300
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('beide behalten', 'behalten')))
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('den vorhandenen ersetzen', 'ersetzen')))
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('den neuen überspringen', 'ueberspringen')))
    $cbGleich.SelectedIndex = 0

    $hZiehen = Neue-Beschriftung -Text 'Am schnellsten geht es ohne dieses Fenster: den Baustein in der Übersicht anfassen und in einen Ordner oder in ein offenes Mailfenster ziehen.' -Klein
    $hZiehen.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $y = 20
    Setze-Unter $flaeche $kopf    ([ref]$y) 24 2
    Setze-Unter $flaeche $wer     ([ref]$y) 24 20
    Setze-Unter $flaeche $kDatei  ([ref]$y) 24 2
    Setze-Unter $flaeche $hDatei  ([ref]$y) 26 14
    Setze-Unter $flaeche $kAblage ([ref]$y) 24 2
    Setze-Unter $flaeche $hAblage ([ref]$y) 26 14
    Setze-Unter $flaeche $kAndere ([ref]$y) 24 2
    Setze-Unter $flaeche $hAndere ([ref]$y) 26 10
    Setze-Unter $flaeche $lGleich ([ref]$y) 26 2
    Setze-Unter $flaeche $cbGleich ([ref]$y) 26 12
    Setze-Unter $flaeche $hZiehen  ([ref]$y) 24 8

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 52; $fuss.BackColor = $global:Farbe.Hintergrund
    $kZu = Neuer-Knopf -Text 'Schließen' -Breite 120
    $kZu.Anchor = 'Top,Right'
    $fuss.Controls.Add($kZu)
    $fenster.Controls.Add($fuss)
    $fenster.ClientSize = New-Object System.Drawing.Size(608, ($hZiehen.Bottom + 18 + $fuss.Height))

    $kDatei.Add_Click({
        $d = New-Object System.Windows.Forms.SaveFileDialog
        $d.Title = 'Bausteine zum Weitergeben speichern'
        $d.Filter = "Bausteine zum Weitergeben (*$($global:WeitergabeEndung))|*$($global:WeitergabeEndung)"
        $d.DefaultExt = $global:WeitergabeEndung.TrimStart('.')
        $d.AddExtension = $true
        $d.FileName = Weitergabe-Dateiname $liste
        $d.OverwritePrompt = $true
        $d.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
        if ($d.ShowDialog() -ne 'OK') { return }
        try {
            Schreib-Weitergabe $liste $d.FileName
        } catch {
            Zeige-Meldung "Die Datei ließ sich nicht schreiben:`r`n`r`n$($_.Exception.Message)" 'Weitergeben' 'Error'
            return
        }
        Zeige-Meldung "Gespeichert:`r`n$($d.FileName)`r`n`r`nDiese Datei kannst du an eine Mail hängen. Wer sie bekommt, zieht sie einfach in sein DocKit-Fenster." 'Weitergeben'
        $fenster.Close()
    }.GetNewClosure())

    $kAblage.Add_Click({
        try {
            $pfad = Erzeuge-Weitergabe-Temp $liste
        } catch {
            Zeige-Meldung "Die Datei ließ sich nicht anlegen:`r`n`r`n$($_.Exception.Message)" 'Weitergeben' 'Error'
            return
        }
        $sammlung = New-Object System.Collections.Specialized.StringCollection
        [void]$sammlung.Add($pfad)
        $daten = New-Object System.Windows.Forms.DataObject
        $daten.SetFileDropList($sammlung)
        [System.Windows.Forms.Clipboard]::SetDataObject($daten, $true)
        Zeige-Meldung "Die Datei liegt in der Zwischenablage.`r`n`r`nWechsle in deine Mail und drücke Strg+V — sie hängt dann als Anlage daran." 'Weitergeben'
        $fenster.Close()
    }.GetNewClosure())

    $kAndere.Add_Click({
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Title = 'In welche Textbausteindatei sollen sie geschrieben werden?'
        $d.Filter = "Textbausteindateien (*$($global:Dateiendung))|*$($global:Dateiendung)|Alle Dateien (*.*)|*.*"
        $d.CheckFileExists = $true
        if ($global:BausteinDatei) { $d.InitialDirectory = Split-Path -Parent $global:BausteinDatei }
        if ($d.ShowDialog() -ne 'OK') { return }

        $erg = Kopiere-In-Datei $liste $d.FileName ([string]$cbGleich.SelectedItem.Wert)
        if (-not $erg.Erfolg) {
            Zeige-Meldung "Es wurde nichts geschrieben.`r`n`r`n$($erg.Grund)" 'Weitergeben' 'Warning'
            return
        }
        $b = $erg.Bilanz
        Zeige-Meldung ("In $(Dateiname-Kurz $d.FileName) geschrieben:`r`n`r`n" +
            "hinzugekommen: $($b.Dazu)`r`nersetzt: $($b.Ersetzt)`r`nübersprungen: $($b.Uebersprungen)") 'Weitergeben'
        $fenster.Close()
    }.GetNewClosure())

    $kZu.Add_Click({ $fenster.Close() }.GetNewClosure())
    $fenster.CancelButton = $kZu

    $ordne = { $kZu.Location = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $kZu.Width), 10) }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown($ordne)

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
}

<#
    --- Übernehmen: das Fenster ---

    Zeigt, was in einer Weitergabedatei steckt, und lässt auswählen. Bausteine,
    deren Name hier schon vergeben ist, stehen in Warnfarbe — was mit ihnen
    geschehen soll, entscheidet die Klappliste unten.

    Rückgabe: $true, wenn etwas übernommen und gespeichert wurde.
#>
function Zeige-Uebernahme {
    param([string]$Pfad)

    $inhalt = Lies-Weitergabe $Pfad
    if ($null -eq $inhalt -or @($inhalt.Bausteine).Count -eq 0) {
        Zeige-Meldung "In dieser Datei stehen keine Bausteine:`r`n$Pfad" 'Übernehmen' 'Warning'
        return $false
    }
    if ($global:NurLesen) {
        Zeige-Meldung 'Die geöffnete Textbausteindatei ist schreibgeschützt. Wechsle erst in eine eigene Datei.' 'Übernehmen' 'Warning'
        return $false
    }

    $fenster = Neues-Fenster -Titel 'Bausteine übernehmen' -Breite 760 -Hoehe 500
    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'; $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $liste = New-Object System.Windows.Forms.ListView
    $liste.Dock = 'Fill'
    $liste.View = 'Details'
    $liste.CheckBoxes = $true
    $liste.FullRowSelect = $true
    $liste.HideSelection = $false
    $liste.BorderStyle = 'FixedSingle'
    [void]$liste.Columns.Add('Baustein', 260)
    [void]$liste.Columns.Add('Kategorie', 150)
    [void]$liste.Columns.Add('Felder', 60)
    [void]$liste.Columns.Add('Hinweis', 240)

    foreach ($b in @($inhalt.Bausteine)) {
        $z = New-Object System.Windows.Forms.ListViewItem([string]$b.name)
        [void]$z.SubItems.Add([string]$b.kategorie)
        [void]$z.SubItems.Add([string](@($b.felder).Count))
        $schon = @($global:Bausteine) | Where-Object { [string]$_.name -eq [string]$b.name } | Select-Object -First 1
        [void]$z.SubItems.Add($(if ($schon) { 'gibt es hier schon' } else { '' }))
        if ($schon) { $z.ForeColor = $global:Farbe.Warnung }
        $z.Checked = $true
        $z.Tag = $b
        [void]$liste.Items.Add($z)
    }
    $flaeche.Controls.Add($liste)

    $kopf = New-Object System.Windows.Forms.Panel
    $kopf.Dock = 'Top'; $kopf.Height = 74; $kopf.BackColor = $global:Farbe.Flaeche
    $t1 = Neue-Beschriftung -Text "$(@($inhalt.Bausteine).Count) Bausteine aus $([System.IO.Path]::GetFileName($Pfad))"
    $t1.Font = $global:SchriftTitel
    $herkunft = if ($inhalt.Von) { "von $($inhalt.Von)" } else { 'ohne Absenderangabe' }
    if ($inhalt.Erzeugt) { $herkunft += ", erzeugt am $($inhalt.Erzeugt)" }
    $t2 = Neue-Beschriftung -Text "$herkunft — Haken setzen bei dem, was du übernehmen willst." -Klein
    $yk = 12
    Setze-Unter $kopf $t1 ([ref]$yk) 20 2
    Setze-Unter $kopf $t2 ([ref]$yk) 20 6
    $flaeche.Controls.Add($kopf)

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 78; $fuss.BackColor = $global:Farbe.Hintergrund
    $lGleich = Neue-Beschriftung -Text 'Bei gleichem Namen:' -Klein
    $lGleich.Location = New-Object System.Drawing.Point(20, 10)
    $cbGleich = New-Object System.Windows.Forms.ComboBox
    $cbGleich.DropDownStyle = 'DropDownList'
    $cbGleich.Width = 280
    $cbGleich.Location = New-Object System.Drawing.Point(20, 32)
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('beide behalten', 'behalten')))
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('den vorhandenen ersetzen', 'ersetzen')))
    [void]$cbGleich.Items.Add((New-Object DocKit.Option('den neuen überspringen', 'ueberspringen')))
    $cbGleich.SelectedIndex = 0
    $kAlle  = Neuer-Knopf -Text 'alle' -Breite 70 -Hoehe 26
    $kKeine = Neuer-Knopf -Text 'keine' -Breite 70 -Hoehe 26
    $kAlle.Font = $global:SchriftKlein; $kKeine.Font = $global:SchriftKlein
    $kAlle.Location  = New-Object System.Drawing.Point(316, 32)
    $kKeine.Location = New-Object System.Drawing.Point(392, 32)
    $kOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 150 -Betont
    $kAus = Neuer-Knopf -Text 'Abbrechen' -Breite 110
    $kOk.Anchor = 'Top,Right'; $kAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($lGleich, $cbGleich, $kAlle, $kKeine, $kOk, $kAus))
    $fenster.Controls.Add($fuss)

    $kAlle.Add_Click({ foreach ($z in $liste.Items) { $z.Checked = $true } }.GetNewClosure())
    $kKeine.Add_Click({ foreach ($z in $liste.Items) { $z.Checked = $false } }.GetNewClosure())

    $global:UebernahmeErfolg = $false
    $kOk.Add_Click({
        $gewaehlt = New-Object System.Collections.ArrayList
        foreach ($z in $liste.Items) { if ($z.Checked) { [void]$gewaehlt.Add($z.Tag) } }
        if ($gewaehlt.Count -eq 0) {
            Zeige-Meldung 'Es ist nichts angehakt.' 'Übernehmen' 'Warning'
            return
        }
        $bilanz = Uebernimm-Bausteine $global:Bausteine $gewaehlt ([string]$cbGleich.SelectedItem.Wert) ([string]$inhalt.Von)
        try {
            Speichere-Bausteine
        } catch {
            Zeige-Meldung "Übernommen, aber das Speichern ist fehlgeschlagen:`r`n`r`n$($_.Exception.Message)" 'Übernehmen' 'Error'
            return
        }
        $global:UebernahmeErfolg = $true
        Zeige-Meldung ("Übernommen in $(Dateiname-Kurz $global:BausteinDatei):`r`n`r`n" +
            "hinzugekommen: $($bilanz.Dazu)`r`nersetzt: $($bilanz.Ersetzt)`r`nübersprungen: $($bilanz.Uebersprungen)") 'Übernehmen'
        $fenster.Close()
    }.GetNewClosure())
    $kAus.Add_Click({ $fenster.Close() }.GetNewClosure())
    $fenster.CancelButton = $kAus

    $ordne = {
        $kOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 20 - $kOk.Width), 26)
        $kAus.Location = New-Object System.Drawing.Point(($kOk.Left - 10 - $kAus.Width), 26)
    }.GetNewClosure()
    $fuss.Add_Resize($ordne)
    $fenster.Add_Shown($ordne)

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:UebernahmeErfolg
}
# =====================================================================
#  9. EINSTELLUNGEN
# =====================================================================

# Auswahlliste der möglichen Tasten für die Tastenkombination.
function Moegliche-Tasten {
    $liste = New-Object System.Collections.ArrayList
    foreach ($c in [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { [void]$liste.Add((New-Object DocKit.Option([string]$c, [string]$c))) }
    for ($i = 1; $i -le 12; $i++) { [void]$liste.Add((New-Object DocKit.Option("F$i", "F$i"))) }
    for ($i = 0; $i -le 9; $i++) { [void]$liste.Add((New-Object DocKit.Option("$i", "D$i"))) }
    [void]$liste.Add((New-Object DocKit.Option('Leertaste', 'Space')))
    [void]$liste.Add((New-Object DocKit.Option('Einfg', 'Insert')))
    return , $liste
}

function Tasten-Anzeige {
    param([string]$Wert)
    foreach ($o in (Moegliche-Tasten)) { if ($o.Wert -eq $Wert) { return $o.Anzeige } }
    return $Wert
}

function Hotkey-Text {
    $teile = @()
    if ($global:Einstellungen.hotkey_strg)     { $teile += 'Strg' }
    if ($global:Einstellungen.hotkey_alt)      { $teile += 'Alt' }
    if ($global:Einstellungen.hotkey_umschalt) { $teile += 'Umschalt' }
    if ($global:Einstellungen.hotkey_windows)  { $teile += 'Windows' }
    $teile += (Tasten-Anzeige $global:Einstellungen.hotkey_taste)
    return ($teile -join ' + ')
}

function Hotkey-Anmelden {
    if ($null -eq $global:Waechter) { return $false }
    $mod = 0x4000   # MOD_NOREPEAT — hält die Taste nicht gedrückt durch
    if ($global:Einstellungen.hotkey_alt)      { $mod = $mod -bor 1 }
    if ($global:Einstellungen.hotkey_strg)     { $mod = $mod -bor 2 }
    if ($global:Einstellungen.hotkey_umschalt) { $mod = $mod -bor 4 }
    if ($global:Einstellungen.hotkey_windows)  { $mod = $mod -bor 8 }
    $taste = [System.Windows.Forms.Keys]::T
    try { $taste = [System.Enum]::Parse([System.Windows.Forms.Keys], [string]$global:Einstellungen.hotkey_taste, $true) } catch { }
    return $global:Waechter.Anmelden([uint32]$mod, [uint32][int]$taste)
}

function Zeige-Einstellungen {

    $fenster = Neues-Fenster -Titel 'Einstellungen' -Breite 620 -Hoehe 520 -Rahmen 'FixedDialog' -MitKennung
    $fenster.MaximizeBox = $false
    $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'
    $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $lTaste = Neue-Beschriftung -Text 'Tastenkombination zum Öffnen der Schnellwahl' -Fett

    $cStrg = New-Object System.Windows.Forms.CheckBox
    $cStrg.Text = 'Strg'; $cStrg.Width = 70
    $cStrg.Checked = [bool]$global:Einstellungen.hotkey_strg

    $cAlt = New-Object System.Windows.Forms.CheckBox
    $cAlt.Text = 'Alt'; $cAlt.Width = 62
    $cAlt.Checked = [bool]$global:Einstellungen.hotkey_alt

    $cUmschalt = New-Object System.Windows.Forms.CheckBox
    $cUmschalt.Text = 'Umschalt'; $cUmschalt.Width = 96
    $cUmschalt.Checked = [bool]$global:Einstellungen.hotkey_umschalt

    $cWin = New-Object System.Windows.Forms.CheckBox
    $cWin.Text = 'Windows'; $cWin.Width = 96
    $cWin.Checked = [bool]$global:Einstellungen.hotkey_windows

    $cbTaste = New-Object System.Windows.Forms.ComboBox
    $cbTaste.DropDownStyle = 'DropDownList'
    $cbTaste.Width = 120
    foreach ($o in (Moegliche-Tasten)) { [void]$cbTaste.Items.Add($o) }
    for ($i = 0; $i -lt $cbTaste.Items.Count; $i++) {
        if ($cbTaste.Items[$i].Wert -eq [string]$global:Einstellungen.hotkey_taste) { $cbTaste.SelectedIndex = $i; break }
    }
    if ($cbTaste.SelectedIndex -lt 0) { $cbTaste.SelectedIndex = 19 }

    $vorschau = Neue-Beschriftung -Text '' -Fett
    $vorschau.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $vorschau.ForeColor = $global:Farbe.Akzent

    $hTaste = Neue-Beschriftung -Text 'Mindestens Strg oder Alt anhaken, sonst blockiert die Kombination normales Tippen.' -Klein

    $trenner = New-Object System.Windows.Forms.Label
    $trenner.BorderStyle = 'Fixed3D'; $trenner.Height = 2; $trenner.Width = 560

    $lVerhalten = Neue-Beschriftung -Text 'Verhalten' -Fett

    $cEinfuegen = New-Object System.Windows.Forms.CheckBox
    $cEinfuegen.Text = 'Text sofort in das zuletzt benutzte Programm einfügen'
$cEinfuegen.Width = 520
    $cEinfuegen.Checked = [bool]$global:Einstellungen.automatisch_einfuegen

    $hEinfuegen = Neue-Beschriftung -Text 'Aus: der Text landet nur in der Zwischenablage und wird von Hand mit Strg+V eingefügt.' -Klein

    $cLeer = New-Object System.Windows.Forms.CheckBox
    $cLeer.Text = 'Überflüssige Leerzeilen entfernen'
$cLeer.Width = 520
    $cLeer.Checked = [bool]$global:Einstellungen.leere_zeilen_aufraeumen

    $hLeer = Neue-Beschriftung -Text 'Sorgt dafür, dass abgewählte Ja/Nein-Abschnitte keine Lücken hinterlassen.' -Klein

    $cRueck = New-Object System.Windows.Forms.CheckBox
    $cRueck.Text = 'Zwischenablage nach dem Einfügen wiederherstellen'
$cRueck.Width = 520
    $cRueck.Checked = [bool]$global:Einstellungen.zwischenablage_zuruecksetzen

    $hRueck = Neue-Beschriftung -Text 'Was vorher kopiert war, steht danach wieder zur Verfügung.' -Klein

    $trenner2 = New-Object System.Windows.Forms.Label
    $trenner2.BorderStyle = 'Fixed3D'; $trenner2.Height = 2; $trenner2.Width = 560

    $lOrdner = Neue-Beschriftung -Text 'Alle Daten liegen hier:' -Fett
    $betriebsart = if ($global:Portabel) { '  (portabel — reist mit dem Stick)' } else { '' }
    $pfadAnzeige = Neue-Beschriftung -Text ("Textbausteine:   " + $(if ($global:BausteinDatei) { $global:BausteinDatei } else { '(keine Datei)' }) +
        [char]13 + [char]10 + "Einstellungen:   " + $global:EinstellDatei + $betriebsart) -Klein
    $pfadAnzeige.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $knopfOrdner = Neuer-Knopf -Text 'Ordner öffnen' -Breite 140 -Hoehe 30

    # --- Schrift für neue Bausteine ---
    $lSchrift = Neue-Beschriftung -Text 'Schrift für neue Bausteine' -Fett

    $pSchrift = New-Object System.Windows.Forms.Panel
    $pSchrift.Size = New-Object System.Drawing.Size(560, 30)

    $cbStdSchrift = New-Object System.Windows.Forms.ComboBox
    $cbStdSchrift.DropDownStyle = 'DropDownList'
    $cbStdSchrift.Width = 190
    $cbStdSchrift.Location = New-Object System.Drawing.Point(0, 0)
    foreach ($fam in ([System.Drawing.Text.InstalledFontCollection]::new()).Families) { [void]$cbStdSchrift.Items.Add($fam.Name) }
    $cbStdSchrift.SelectedItem = [string]$global:Einstellungen.standard_schriftart
    if ($cbStdSchrift.SelectedIndex -lt 0) { $cbStdSchrift.SelectedItem = 'Arial' }

    $cbStdGroesse = New-Object System.Windows.Forms.ComboBox
    $cbStdGroesse.DropDownStyle = 'DropDown'
    $cbStdGroesse.Width = 62
    $cbStdGroesse.Location = New-Object System.Drawing.Point(198, 0)
    foreach ($g in @(8, 9, 10, 11, 12, 14, 16, 18, 20, 24)) { [void]$cbStdGroesse.Items.Add($g) }
    $cbStdGroesse.Text = [string]$global:Einstellungen.standard_groesse

    $cbStdAbstand = New-Object System.Windows.Forms.ComboBox
    $cbStdAbstand.DropDownStyle = 'DropDownList'
    $cbStdAbstand.Width = 128
    $cbStdAbstand.Location = New-Object System.Drawing.Point(268, 0)
    foreach ($a in @('1,0 Zeilen', '1,15 Zeilen', '1,5 Zeilen', '2,0 Zeilen')) { [void]$cbStdAbstand.Items.Add($a) }
    $abstandText = ([string]$global:Einstellungen.standard_zeilenabstand) -replace '\.', ','
    $cbStdAbstand.SelectedItem = "$abstandText Zeilen"
    if ($cbStdAbstand.SelectedIndex -lt 0) { $cbStdAbstand.SelectedItem = '1,5 Zeilen' }

    $pSchrift.Controls.AddRange(@($cbStdSchrift, $cbStdGroesse, $cbStdAbstand))

    $hSchrift = Neue-Beschriftung -Text 'Gilt für neu angelegte Bausteine. Vorhandene behalten ihre eigene Formatierung.' -Klein

    $cNurText = New-Object System.Windows.Forms.CheckBox
    $cNurText.Text = 'Immer nur reinen Text einfügen (ohne Formatierung)'
    $cNurText.AutoSize = $true
    $cNurText.Checked = [bool]$global:Einstellungen.nur_reiner_text

    $hNurText = Neue-Beschriftung -Text 'Nur einschalten, wenn ein Programm mit formatiertem Text nicht zurechtkommt.' -Klein

    # --- Kürzel-Erkennung ---
    $trenner3 = New-Object System.Windows.Forms.Label
    $trenner3.BorderStyle = 'Fixed3D'; $trenner3.Height = 2; $trenner3.Width = 560

    $lAutotext = Neue-Beschriftung -Text 'Kürzel-Erkennung' -Fett

    $cAutotext = New-Object System.Windows.Forms.CheckBox
    $cAutotext.Text = 'Kürzel wie #AV beim Tippen erkennen — in jedem Programm, nicht nur in DocKit'
    $cAutotext.AutoSize = $true
    $cAutotext.Checked = [bool]$global:Einstellungen.autotext_aktiv

    $hAutotext = Neue-Beschriftung -Text (
        'Braucht dafür einen systemweiten Tastatur-Mitleser — dieselbe Technik, die z. B. ' +
        'PhraseExpress benutzt. Deshalb standardmäßig aus. Aufgezeichnet oder gespeichert wird ' +
        'nichts: Nur die letzten paar Zeichen seit dem letzten Leerzeichen werden kurz im Speicher ' +
        'gehalten und sofort wieder vergessen, sobald geprüft ist, ob eines der hinterlegten Kürzel ' +
        'passt. Manche Virenschutz-Programme stufen diese Art Mitleser dennoch als verdächtig ein — ' +
        'bei Problemen hier wieder ausschalten. Welches Kürzel zu welchem Baustein gehört, wird bei ' +
        'jedem Baustein einzeln festgelegt (leer = nimmt nicht teil).'
    ) -Klein
    $hAutotext.MaximumSize = New-Object System.Drawing.Size(560, 0)

    # --- Anordnung: alles untereinander, Höhen werden gemessen statt geraten ---
    $y = 20
    Setze-Unter $flaeche $lTaste ([ref]$y) 20 8

    # Die vier Zusatztasten nebeneinander, mit ihrer jeweils benötigten Breite
    foreach ($c in @($cStrg, $cAlt, $cUmschalt, $cWin)) {
        $c.AutoSize = $true
        [void]$flaeche.Controls.Add($c)
    }
    [void]$flaeche.Controls.Add($cbTaste)
    $x = 20
    foreach ($c in @($cStrg, $cAlt, $cUmschalt, $cWin)) {
        $c.Location = New-Object System.Drawing.Point($x, ($y + 3))
        $x += $c.Width + 16
    }
    $cbTaste.Location = New-Object System.Drawing.Point($x, $y)
    $y += [Math]::Max($cbTaste.Height, $cStrg.Height) + 14

    Setze-Unter $flaeche $vorschau ([ref]$y) 20 6
    Setze-Unter $flaeche $hTaste   ([ref]$y) 20 14

    $trenner.Anchor = 'Top,Left,Right'
    Setze-Unter $flaeche $trenner ([ref]$y) 20 14

    Setze-Unter $flaeche $lVerhalten ([ref]$y) 20 10
    Setze-Unter $flaeche $cEinfuegen ([ref]$y) 20 2
    Setze-Unter $flaeche $hEinfuegen ([ref]$y) 40 12
    Setze-Unter $flaeche $cLeer      ([ref]$y) 20 2
    Setze-Unter $flaeche $hLeer      ([ref]$y) 40 12
    Setze-Unter $flaeche $cRueck     ([ref]$y) 20 2
    Setze-Unter $flaeche $hRueck     ([ref]$y) 40 16

    Setze-Unter $flaeche $lSchrift ([ref]$y) 20 6
    Setze-Unter $flaeche $pSchrift ([ref]$y) 20 3
    Setze-Unter $flaeche $hSchrift ([ref]$y) 20 12
    Setze-Unter $flaeche $cNurText ([ref]$y) 20 2
    Setze-Unter $flaeche $hNurText ([ref]$y) 40 16

    $trenner3.Anchor = 'Top,Left,Right'
    Setze-Unter $flaeche $trenner3 ([ref]$y) 20 14
    Setze-Unter $flaeche $lAutotext ([ref]$y) 20 10
    Setze-Unter $flaeche $cAutotext ([ref]$y) 20 2
    Setze-Unter $flaeche $hAutotext ([ref]$y) 40 16

    $trenner2.Anchor = 'Top,Left,Right'
    Setze-Unter $flaeche $trenner2 ([ref]$y) 20 14

    Setze-Unter $flaeche $lOrdner     ([ref]$y) 20 4
    Setze-Unter $flaeche $pfadAnzeige ([ref]$y) 20 12
    Setze-Unter $flaeche $knopfOrdner ([ref]$y) 20 12

    $fuss = New-Object System.Windows.Forms.Panel
    $fuss.Dock = 'Bottom'; $fuss.Height = 56; $fuss.BackColor = $global:Farbe.Hintergrund
    $knopfOk  = Neuer-Knopf -Text 'Übernehmen' -Breite 140 -Betont
    $knopfAus = Neuer-Knopf -Text 'Abbrechen' -Breite 120
    $knopfOk.Anchor = 'Top,Right'; $knopfAus.Anchor = 'Top,Right'
    $fuss.Controls.AddRange(@($knopfOk, $knopfAus))
    $fenster.Controls.Add($fuss)

    # Fensterhöhe aus dem tatsächlichen Inhalt ableiten, damit unten nichts abgeschnitten wird.
    $fenster.ClientSize = New-Object System.Drawing.Size($fenster.ClientSize.Width, ($knopfOrdner.Bottom + 16 + $fuss.Height))

    $zeigeVorschau = {
        $teile = @()
        if ($cStrg.Checked)     { $teile += 'Strg' }
        if ($cAlt.Checked)      { $teile += 'Alt' }
        if ($cUmschalt.Checked) { $teile += 'Umschalt' }
        if ($cWin.Checked)      { $teile += 'Windows' }
        if ($cbTaste.SelectedItem) { $teile += $cbTaste.SelectedItem.Anzeige }
        $vorschau.Text = ($teile -join ' + ')
    }.GetNewClosure()

    foreach ($c in @($cStrg, $cAlt, $cUmschalt, $cWin)) { $c.Add_CheckedChanged($zeigeVorschau) }
    $cbTaste.Add_SelectedIndexChanged($zeigeVorschau)

    $knopfOrdner.Add_Click({ & $global:DateiOrdnerKlick }.GetNewClosure())
    $knopfAus.Add_Click({ $fenster.DialogResult = 'Cancel'; $fenster.Close() }.GetNewClosure())

    $knopfOk.Add_Click({
        if (-not ($cStrg.Checked -or $cAlt.Checked -or $cWin.Checked)) {
            Zeige-Meldung 'Bitte mindestens Strg, Alt oder Windows anhaken.' 'Tastenkombination' 'Warning'
            return
        }
        $alt = @{
            strg = $global:Einstellungen.hotkey_strg; alt = $global:Einstellungen.hotkey_alt
            um = $global:Einstellungen.hotkey_umschalt; win = $global:Einstellungen.hotkey_windows
            taste = $global:Einstellungen.hotkey_taste
        }
        $global:Einstellungen.hotkey_strg     = $cStrg.Checked
        $global:Einstellungen.hotkey_alt      = $cAlt.Checked
        $global:Einstellungen.hotkey_umschalt = $cUmschalt.Checked
        $global:Einstellungen.hotkey_windows  = $cWin.Checked
        $global:Einstellungen.hotkey_taste    = $cbTaste.SelectedItem.Wert
        $global:Einstellungen.automatisch_einfuegen        = $cEinfuegen.Checked
        $global:Einstellungen.leere_zeilen_aufraeumen      = $cLeer.Checked
        $global:Einstellungen.zwischenablage_zuruecksetzen = $cRueck.Checked
        $global:Einstellungen.nur_reiner_text              = $cNurText.Checked

        # Sofort wirksam, kein Neustart nötig — weder beim Ein- noch beim Ausschalten.
        $global:Einstellungen.autotext_aktiv = $cAutotext.Checked
        if ($cAutotext.Checked) { Starte-Autotext } else { Stoppe-Autotext }

        if ($cbStdSchrift.SelectedItem) { $global:Einstellungen.standard_schriftart = [string]$cbStdSchrift.SelectedItem }
        $zahl = 12.0
        if ([double]::TryParse(($cbStdGroesse.Text -replace ',', '.'), [System.Globalization.NumberStyles]::Float,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$zahl) -and $zahl -ge 5 -and $zahl -le 200) {
            $global:Einstellungen.standard_groesse = $zahl
        }
        if ($cbStdAbstand.SelectedItem) {
            $roh = ([string]$cbStdAbstand.SelectedItem -replace '[^0-9,]', '') -replace ',', '.'
            $ab = 1.5
            if ([double]::TryParse($roh, [System.Globalization.NumberStyles]::Float,
                    [System.Globalization.CultureInfo]::InvariantCulture, [ref]$ab)) {
                $global:Einstellungen.standard_zeilenabstand = $ab
            }
        }

        if (-not (Hotkey-Anmelden)) {
            Zeige-Meldung "Die Tastenkombination $(Hotkey-Text) ist bereits von einem anderen Programm belegt. Bitte eine andere wählen." 'Belegt' 'Warning'
            $global:Einstellungen.hotkey_strg = $alt.strg; $global:Einstellungen.hotkey_alt = $alt.alt
            $global:Einstellungen.hotkey_umschalt = $alt.um; $global:Einstellungen.hotkey_windows = $alt.win
            $global:Einstellungen.hotkey_taste = $alt.taste
            [void](Hotkey-Anmelden)
            return
        }
        Speichere-Einstellungen
        if ($global:Tray) { $global:Tray.Text = "DocKit — $(Hotkey-Text)" }
        if ($global:MenueSchnellwahl) { $global:MenueSchnellwahl.Text = "Schnellwahl öffnen   ($(Hotkey-Text))" }
        $fenster.DialogResult = 'OK'
        $fenster.Close()
    }.GetNewClosure())

    $fuss.Add_Resize({
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
    }.GetNewClosure())

    $fenster.Add_Shown({
        $knopfOk.Location  = New-Object System.Drawing.Point(($fuss.ClientSize.Width - 16 - $knopfOk.Width), 11)
        $knopfAus.Location = New-Object System.Drawing.Point(($knopfOk.Left - 10 - $knopfAus.Width), 11)
        & $zeigeVorschau
    }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
}


# =====================================================================
#  10. START
# =====================================================================

function Oeffne-Anleitung {
    $kandidaten = @(
        (Join-Path $global:BasisOrdner 'Anleitung.html'),
        (Join-Path $global:BasisOrdner 'README.md')
    )
    foreach ($k in $kandidaten) {
        if (Test-Path -LiteralPath $k) { Start-Process $k; return }
    }
    Start-Process 'explorer.exe' -ArgumentList $global:BasisOrdner
}

<#
    Das erste Fenster beim allerersten Start. Es entscheidet nur eines: Mit welcher
    Textbausteindatei wird gearbeitet? Rückgabe $true, wenn danach eine offen ist.
#>
function Zeige-Willkommen {

    $fenster = Neues-Fenster -Titel 'DocKit — willkommen' -Breite 620 -Hoehe 380 -Rahmen 'FixedDialog'
    $fenster.MaximizeBox = $false
    $fenster.MinimizeBox = $false

    $flaeche = New-Object System.Windows.Forms.Panel
    $flaeche.Dock = 'Fill'
    $flaeche.BackColor = $global:Farbe.Flaeche
    $fenster.Controls.Add($flaeche)

    $titel = Neue-Beschriftung -Text 'Wo sollen deine Textbausteine liegen?' -Fett
    $titel.Font = $global:SchriftTitel

    $text = Neue-Beschriftung -Text ("Alle Bausteine stehen in einer Textbausteindatei. Du kannst eine vorhandene öffnen — " +
        "etwa die gemeinsame Datei deiner Dienststelle auf einem Laufwerk — oder dir eine eigene anlegen." + [char]13 + [char]10 + [char]13 + [char]10 +
        "Zwischen mehreren Dateien lässt sich später jederzeit wechseln, ohne das Programm zu beenden.")
    $text.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $knopfOeffnen = Neuer-Knopf -Text 'Vorhandene Datei öffnen …' -Breite 260 -Hoehe 40 -Betont
    $knopfNeu     = Neuer-Knopf -Text 'Neue Datei anlegen …' -Breite 260 -Hoehe 40
    $hinweisNeu   = Neue-Beschriftung -Text 'Eine neue Datei startet mit vier Beispielbausteinen, die du löschen oder umbauen kannst.' -Klein
    $hinweisNeu.MaximumSize = New-Object System.Drawing.Size(560, 0)

    $knopfEnde = Neuer-Knopf -Text 'Beenden' -Breite 120 -Hoehe 30

    $y = 24
    Setze-Unter $flaeche $titel       ([ref]$y) 26 10
    Setze-Unter $flaeche $text        ([ref]$y) 26 22
    Setze-Unter $flaeche $knopfOeffnen ([ref]$y) 26 10
    Setze-Unter $flaeche $knopfNeu    ([ref]$y) 26 8
    Setze-Unter $flaeche $hinweisNeu  ([ref]$y) 26 18
    Setze-Unter $flaeche $knopfEnde   ([ref]$y) 26 20
    $fenster.ClientSize = New-Object System.Drawing.Size(608, ($knopfEnde.Bottom + 24))

    $global:WillkommenErfolg = $false

    $knopfOeffnen.Add_Click({
        $pfad = Frage-Bausteindatei-Oeffnen
        if ($pfad -and (Oeffne-Bausteindatei $pfad)) {
            $global:WillkommenErfolg = $true
            $fenster.Close()
        }
    }.GetNewClosure())

    $knopfNeu.Add_Click({
        $pfad = Frage-Bausteindatei-Neu
        if (-not $pfad) { return }
        try {
            Erzeuge-Bausteindatei $pfad
        } catch {
            Zeige-Meldung "Die Datei konnte nicht angelegt werden:`r`n`r`n$($_.Exception.Message)" 'Anlegen fehlgeschlagen' 'Error'
            return
        }
        if (Oeffne-Bausteindatei $pfad) {
            $global:WillkommenErfolg = $true
            $fenster.Close()
        }
    }.GetNewClosure())

    $knopfEnde.Add_Click({ $fenster.Close() }.GetNewClosure())

    [void]$fenster.ShowDialog()
    $fenster.Dispose()
    return $global:WillkommenErfolg
}

# Ein Menüeintrag je zuletzt benutzter Datei. Bewusst ohne Closure: alles kommt
# vom Absender, damit nichts verloren geht (siehe Hinweis in der README).
$global:DateiWechsel = {
    param($absender, $e)
    $pfad = [string]$absender.Tag
    if ([string]::IsNullOrWhiteSpace($pfad)) { return }
    if ($pfad -eq $global:BausteinDatei) { return }
    if ($global:VerwaltungOffen) {
        Zeige-Meldung 'Bitte erst das Verwaltungsfenster schließen — dort könnten ungespeicherte Änderungen stehen.' 'Datei wechseln' 'Warning'
        return
    }
    [void](Oeffne-Bausteindatei $pfad)
}

# Verhindert, dass beim Wechseln ungespeicherte Arbeit untergeht.
function Wechsel-Erlaubt {
    if ($global:VerwaltungOffen) {
        Zeige-Meldung 'Bitte erst das Verwaltungsfenster schließen — dort könnten ungespeicherte Änderungen stehen.' 'Datei wechseln' 'Warning'
        return $false
    }
    return $true
}

$global:DateiOeffnenKlick = {
    if (-not (Wechsel-Erlaubt)) { return }
    $pfad = Frage-Bausteindatei-Oeffnen
    if ($pfad) { [void](Oeffne-Bausteindatei $pfad) }
}

$global:DateiNeuKlick = {
    if (-not (Wechsel-Erlaubt)) { return }
    $pfad = Frage-Bausteindatei-Neu
    if (-not $pfad) { return }
    try { Erzeuge-Bausteindatei $pfad }
    catch {
        Zeige-Meldung "Die Datei konnte nicht angelegt werden:`r`n`r`n$($_.Exception.Message)" 'Anlegen fehlgeschlagen' 'Error'
        return
    }
    if (Oeffne-Bausteindatei $pfad) {
        Zeige-Meldung "Die neue Datei ist angelegt und geöffnet:`r`n`r`n$pfad`r`n`r`nSie enthält vier Beispielbausteine zum Umbauen oder Löschen." 'Neue Textbausteindatei'
    }
}

<#
    Bausteine übernehmen: aus einer Weitergabedatei, die ein Kollege geschickt
    hat, oder aus einer ganzen Textbausteindatei. Der Weg über das Menü ist der
    zweite; der erste ist, die Datei einfach in die Übersicht zu ziehen.
#>
$global:BausteineUebernehmenKlick = {
    if ($global:VerwaltungOffen) {
        Zeige-Meldung 'Bitte erst das Verwaltungsfenster schließen — dort könnten ungespeicherte Änderungen stehen.' 'Übernehmen' 'Warning'
        return
    }
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Title = 'Bausteine übernehmen'
    $d.Filter = "Bausteine und Textbausteindateien (*$($global:WeitergabeEndung);*$($global:Dateiendung))|*$($global:WeitergabeEndung);*$($global:Dateiendung)|Alle Dateien (*.*)|*.*"
    $d.CheckFileExists = $true
    if ($global:BausteinDatei) { $d.InitialDirectory = Split-Path -Parent $global:BausteinDatei }
    if ($d.ShowDialog() -ne 'OK') { return }
    [void](Zeige-Uebernahme $d.FileName)
}

$global:DateiOrdnerKlick = {
    if ($global:BausteinDatei -and (Test-Path -LiteralPath $global:BausteinDatei)) {
        Start-Process 'explorer.exe' -ArgumentList "/select,`"$($global:BausteinDatei)`""
    }
}

function Starte-Programm {

    $global:Einstellungen = Lade-Einstellungen
    $global:Bausteine     = New-Object System.Collections.ArrayList
    $global:Vorlagen      = New-Object System.Collections.ArrayList
    $global:Kombinationen = New-Object System.Collections.ArrayList
    $global:Symbol        = Erzeuge-Symbol
    $global:Zielfenster   = [IntPtr]::Zero
    $global:SchnellwahlOffen = $false
    $global:VerwaltungOffen  = $false

    <#
        Welche Textbausteindatei? In dieser Reihenfolge:
          1. die zuletzt benutzte
          2. der Bestand aus früheren Fassungen neben dem Programm
          3. das Willkommensfenster — öffnen oder neu anlegen
    #>
    $offen = $false
    if ($global:Einstellungen.aktuelle_datei) {
        $offen = Oeffne-Bausteindatei $global:Einstellungen.aktuelle_datei -Leise
    }
    if (-not $offen) {
        $altbestand = Join-Path $global:AltDatenOrdner 'bausteine.json'
        if (Test-Path -LiteralPath $altbestand) { $offen = Oeffne-Bausteindatei $altbestand -Leise }
    }
    if (-not $offen) { $offen = Zeige-Willkommen }
    if (-not $offen) { return }        # abgebrochen — dann startet nichts

    # --- Symbol im Infobereich der Taskleiste ---
    $global:Tray = New-Object System.Windows.Forms.NotifyIcon
    $global:Tray.Icon = $global:Symbol
    $global:Tray.Visible = $true

    $menue = New-Object System.Windows.Forms.ContextMenuStrip
    $menue.Font = $global:Schrift

    $global:MenueSchnellwahl = $menue.Items.Add('Schnellwahl öffnen')
    $global:MenueSchnellwahl.Font = $global:SchriftFett
    [void]$menue.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    # Untermenü zum Wechseln der Textbausteindatei. Es wird bei jedem Aufklappen
    # neu aufgebaut, damit die Liste der zuletzt benutzten aktuell bleibt.
    $mDatei = New-Object System.Windows.Forms.ToolStripMenuItem
    $mDatei.Text = 'Textbausteindatei'
    [void]$menue.Items.Add($mDatei)

    $menue.Add_Opening({
        $mDatei.DropDownItems.Clear()
        $mDatei.Text = "Textbausteindatei:  $(Dateiname-Kurz $global:BausteinDatei)"
        foreach ($p in @($global:Einstellungen.zuletzt_verwendet)) {
            if ([string]::IsNullOrWhiteSpace($p)) { continue }
            $e = $mDatei.DropDownItems.Add((Dateiname-Kurz $p))
            $e.Tag = [string]$p
            $e.ToolTipText = [string]$p
            if ($p -eq $global:BausteinDatei) { $e.Checked = $true; $e.Font = $global:SchriftFett }
            if (-not (Test-Path -LiteralPath $p)) { $e.Text += '   (nicht erreichbar)'; $e.Enabled = $false }
            $e.Add_Click($global:DateiWechsel)
        }
        if ($mDatei.DropDownItems.Count -gt 0) {
            [void]$mDatei.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator))
        }
        $auf = $mDatei.DropDownItems.Add('Andere Datei öffnen …')
        $auf.Add_Click($global:DateiOeffnenKlick)
        $neu = $mDatei.DropDownItems.Add('Neue Datei anlegen …')
        $neu.Add_Click($global:DateiNeuKlick)
        $ord = $mDatei.DropDownItems.Add('Ordner der Datei öffnen')
        $ord.Add_Click($global:DateiOrdnerKlick)
        [void]$mDatei.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator))
        $uebern = $mDatei.DropDownItems.Add('Bausteine übernehmen …')
        $uebern.Add_Click($global:BausteineUebernehmenKlick)
    }.GetNewClosure())

    $mVerwalten     = $menue.Items.Add('Bausteine verwalten…')
    $mEinstellungen = $menue.Items.Add('Einstellungen…')
    [void]$menue.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $mAnleitung = $menue.Items.Add('Anleitung öffnen')
    $mBeenden   = $menue.Items.Add('DocKit beenden')
    $global:Tray.ContextMenuStrip = $menue

    # --- Tastenkombination ---
    $global:Waechter = New-Object DocKit.Tastenwaechter
    $global:Waechter.add_Gedrueckt({
        $global:Zielfenster = [DocKit.Windows]::GetForegroundWindow()
        Zeige-Schnellwahl
    })

    $angemeldet = Hotkey-Anmelden
    $global:Tray.Text = "DocKit — $(Hotkey-Text)"
    $global:MenueSchnellwahl.Text = "Schnellwahl öffnen   ($(Hotkey-Text))"

    # --- Kürzel-Erkennung (nur, wenn in den Einstellungen eingeschaltet) ---
    if ($global:Einstellungen.autotext_aktiv) { Starte-Autotext }

    $kontext = New-Object System.Windows.Forms.ApplicationContext

    $global:MenueSchnellwahl.Add_Click({
        $global:Zielfenster = [DocKit.Windows]::GetForegroundWindow()
        Zeige-Schnellwahl
    })
    $mVerwalten.Add_Click({ Zeige-Verwaltung })
    $mEinstellungen.Add_Click({ Zeige-Einstellungen })
    $mAnleitung.Add_Click({ Oeffne-Anleitung })
    $mBeenden.Add_Click({
        Stoppe-Autotext
        $global:Tray.Visible = $false
        $kontext.ExitThread()
    }.GetNewClosure())

    $global:Tray.Add_MouseClick({
        param($absender, $e)
        if ($e.Button -eq 'Left') {
            $global:Zielfenster = [DocKit.Windows]::GetForegroundWindow()
            Zeige-Schnellwahl
        }
    })

    # --- Begrüßung ---
    if ($angemeldet) {
        $global:Tray.ShowBalloonTip(6000, 'DocKit läuft',
            "$(Hotkey-Text) öffnet die Schnellwahl — in jedem Programm.", 'Info')
    } else {
        $global:Tray.ShowBalloonTip(9000, 'Tastenkombination belegt',
            "$(Hotkey-Text) wird bereits von einem anderen Programm benutzt. Bitte in den Einstellungen eine andere wählen.", 'Warning')
    }

    if (@($global:Bausteine).Count -eq 0) {
        Zeige-Meldung ("Es sind noch keine Textbausteine vorhanden.`r`n`r`n" +
                       'Das Verwaltungsfenster öffnet sich gleich — dort den ersten Baustein anlegen.') 'Willkommen'
        Zeige-Verwaltung
    }

    [System.Windows.Forms.Application]::Run($kontext)

    # --- Aufräumen ---
    if ($global:Waechter) { $global:Waechter.Dispose() }
    if ($global:Tray) { $global:Tray.Visible = $false; $global:Tray.Dispose() }
}


# --- Nur einmal starten ---------------------------------------------------------
$neuerStart = $false
$global:Sperre = New-Object System.Threading.Mutex($true, 'DocKit_Werkzeug', [ref]$neuerStart)

if (-not $neuerStart) {
    [void][System.Windows.Forms.MessageBox]::Show(
        'DocKit läuft bereits. Das Symbol findest du unten rechts im Infobereich der Taskleiste (eventuell hinter dem kleinen Pfeil).',
        'DocKit', 'OK', 'Information')
    return
}

try {
    Starte-Programm
}
catch {
    $meldung = "Beim Start ist ein Fehler aufgetreten:`r`n`r`n$($_.Exception.Message)`r`n`r`nStelle: $($_.InvocationInfo.PositionMessage)"
    [void][System.Windows.Forms.MessageBox]::Show($meldung, 'DocKit — Fehler', 'OK', 'Error')
}
finally {
    if ($global:Sperre) { $global:Sperre.ReleaseMutex(); $global:Sperre.Dispose() }
}
