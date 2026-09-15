// Tray icon with an explicit GUID identity.
//
// Windows identifies a tray icon by its executable plus a numeric id, which is
// why every PowerShell based tray icon fights over the same slot: change the
// tooltip or restart a script and the shell treats it as a brand new icon and
// hides it in the overflow area again.
//
// Registering the icon with a GUID (NIF_GUID) gives it a stable identity, so
// the place the user drags it to is remembered across restarts, no matter how
// often the icon image or the script changes.
//
// ASCII only, see host/common.ps1.

using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class TrayIconHost : NativeWindow, IDisposable
{
    private const int WM_TRAYICON = 0x8001; // WM_APP + 1

    private const int NIM_ADD = 0x00000000;
    private const int NIM_MODIFY = 0x00000001;
    private const int NIM_DELETE = 0x00000002;
    private const int NIM_SETVERSION = 0x00000004;

    private const int NIF_MESSAGE = 0x00000001;
    private const int NIF_ICON = 0x00000002;
    private const int NIF_TIP = 0x00000004;
    private const int NIF_INFO = 0x00000010;
    private const int NIF_GUID = 0x00000020;
    private const int NIF_SHOWTIP = 0x00000080;

    private const int NOTIFYICON_VERSION_4 = 4;

    private const int WM_CONTEXTMENU = 0x007B;
    private const int WM_LBUTTONUP = 0x0202;
    private const int NIN_SELECT = 0x0400;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public int uID;
        public int uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public int dwState;
        public int dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public int uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public int dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(int message, ref NOTIFYICONDATA data);

    private readonly Guid identity;
    private readonly string tooltip;
    private bool shown;

    public event Action LeftClick;
    public event Action RightClick;

    public TrayIconHost(Guid identity, string tooltip)
    {
        this.identity = identity;
        this.tooltip = tooltip ?? string.Empty;

        CreateParams parameters = new CreateParams();
        parameters.Caption = "opencode-status-popup";
        parameters.ExStyle = 0x00000080; // WS_EX_TOOLWINDOW
        CreateHandle(parameters);
    }

    public bool Show(Icon icon)
    {
        NOTIFYICONDATA data = NewData();
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_GUID | NIF_SHOWTIP;
        data.uCallbackMessage = WM_TRAYICON;
        data.hIcon = icon == null ? IntPtr.Zero : icon.Handle;
        data.szTip = tooltip;
        data.uVersion = NOTIFYICON_VERSION_4;

        shown = Shell_NotifyIcon(NIM_ADD, ref data);
        if (shown)
        {
            // Version 4 gives us NIN_SELECT for clicks and the cursor position in
            // the callback, so the coordinates can be read from wParam.
            Shell_NotifyIcon(NIM_SETVERSION, ref data);
        }
        return shown;
    }

    public void Update(Icon icon)
    {
        if (!shown || icon == null) return;

        NOTIFYICONDATA data = NewData();
        data.uFlags = NIF_ICON | NIF_GUID;
        data.hIcon = icon.Handle;
        Shell_NotifyIcon(NIM_MODIFY, ref data);
    }

    public void ShowBalloon(string title, string text)
    {
        if (!shown) return;

        NOTIFYICONDATA data = NewData();
        data.uFlags = NIF_INFO | NIF_GUID;
        data.szInfoTitle = title ?? string.Empty;
        data.szInfo = text ?? string.Empty;
        Shell_NotifyIcon(NIM_MODIFY, ref data);
    }

    public void Hide()
    {
        if (!shown) return;

        NOTIFYICONDATA data = NewData();
        Shell_NotifyIcon(NIM_DELETE, ref data);
        shown = false;
    }

    private NOTIFYICONDATA NewData()
    {
        NOTIFYICONDATA data = new NOTIFYICONDATA();
        data.cbSize = Marshal.SizeOf(typeof(NOTIFYICONDATA));
        data.hWnd = Handle;
        data.uID = 0;
        data.guidItem = identity;
        return data;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WM_TRAYICON)
        {
            int meaning = (int)((long)message.LParam & 0xFFFF);
            if (meaning == WM_CONTEXTMENU)
            {
                Action handler = RightClick;
                if (handler != null) handler();
            }
            else if (meaning == NIN_SELECT || meaning == WM_LBUTTONUP)
            {
                Action handler = LeftClick;
                if (handler != null) handler();
            }
        }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        Hide();
        if (Handle != IntPtr.Zero) DestroyHandle();
    }
}
