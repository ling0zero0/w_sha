#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#define MyAppName "W_SHA 局域网狼人杀"
#define MyAppPublisher "W_SHA"
#define MyAppExeName "启动狼人杀.cmd"

[Setup]
AppId={{4B59BA76-D8B7-4C25-94E9-F4D0C71E52E9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\W_SHA
DefaultGroupName={#MyAppName}
OutputDir=..\release
OutputBaseFilename=W_SHA-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\node.exe
WizardStyle=modern

[Files]
Source: "..\.runtime\package-portable\W_SHA\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppExeName}"""; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppExeName}"""; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""W_SHA 局域网狼人杀"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""W_SHA 局域网狼人杀"" dir=in action=allow program=""{app}\node.exe"" enable=yes profile=private"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppExeName}"""; WorkingDir: "{app}"; Description: "启动 {#MyAppName}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""W_SHA 局域网狼人杀"""; Flags: runhidden
