; Inno Setup script. Build: iscc /DAppVersion=0.1.0 packaging\windows\chorus.iss  (run from the repository root, after PyInstaller)
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B6A8F2C4-5D1E-4C57-9E0B-3D2F6A7C1E10}
AppName=Chorus
AppVersion={#AppVersion}
AppPublisher=Chorus
DefaultDirName={autopf}\Chorus
DefaultGroupName=Chorus
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\dist
OutputBaseFilename=Chorus-Setup-{#AppVersion}
SetupIconFile=..\assets\chorus.ico
UninstallDisplayIcon={app}\Chorus.exe
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "autostart"; Description: "Start Chorus when I sign in to Windows"; Flags: unchecked

[Files]
Source: "..\..\dist\Chorus\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Chorus"; Filename: "{app}\Chorus.exe"


[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Chorus"; ValueData: """{app}\Chorus.exe"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\Chorus.exe"; Description: "Start Chorus"; Flags: nowait postinstall skipifsilent

; The uninstaller leaves %APPDATA%\Chorus (library, lyrics, settings) alone on purpose.
