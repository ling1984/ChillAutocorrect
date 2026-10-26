// These helpers are bundled into main.js. Words are sent as JSON over stdin,
// never interpolated into executable code or command-line arguments.
export const WINDOWS_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellCheckerFactory {
    IEnumString GetSupportedLanguages();
    [return: MarshalAs(UnmanagedType.Bool)] bool IsSupported([MarshalAs(UnmanagedType.LPWStr)] string language);
    ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string language);
}
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellChecker {
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetLanguageTag();
    IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text);
    IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
}
[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumSpellingError {
    [PreserveSig] int Next(out IntPtr error);
}
public class NativeSpellingResult {
    public bool Misspelled;
    public string[] Suggestions;
}
public static class NativeSpelling {
    static readonly ISpellCheckerFactory Factory = (ISpellCheckerFactory)Activator.CreateInstance(
        Type.GetTypeFromCLSID(new Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")));
    static readonly Dictionary<string, ISpellChecker> Checkers = new Dictionary<string, ISpellChecker>();
    public static NativeSpellingResult Check(string word, string[] languages) {
        if (languages == null || languages.Length == 0) throw new Exception("No spelling languages configured in Obsidian.");
        // Do not correct using only a subset of the configured languages.
        foreach (string language in languages) {
            if (!Factory.IsSupported(language)) throw new Exception("Windows spelling language unavailable: " + language);
        }
        var suggestions = new List<string>();
        foreach (string language in languages) {
            ISpellChecker checker;
            if (!Checkers.TryGetValue(language, out checker)) {
                checker = Factory.CreateSpellChecker(language);
                Checkers.Add(language, checker);
            }
            var errors = checker.Check(word);
            IntPtr error;
            int hr;
            try { hr = errors.Next(out error); }
            finally { Marshal.ReleaseComObject(errors); }
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            if (error == IntPtr.Zero) return new NativeSpellingResult { Misspelled = false, Suggestions = new string[0] };
            Marshal.Release(error);
            var guesses = checker.Suggest(word);
            try {
                var item = new string[1];
                while (guesses.Next(1, item, IntPtr.Zero) == 0 && suggestions.Count < 32) {
                    if (!suggestions.Contains(item[0])) suggestions.Add(item[0]);
                }
            } finally { Marshal.ReleaseComObject(guesses); }
        }
        return new NativeSpellingResult { Misspelled = true, Suggestions = suggestions.ToArray() };
    }
}
'@
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $result = [NativeSpelling]::Check([string]$request.word, [string[]]$request.languages)
        $response = @{ id = $request.id; misspelled = $result.Misspelled; suggestions = @($result.Suggestions) }
    } catch {
        $response = @{ id = $request.id; error = $_.Exception.Message }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 4))
}
`;

// Shared by the production helper and the isolated macOS selector test.
// JXA maps JS null to NSNull, not Objective-C nil. $() is the bridge's nil
// object; Ref() supplies the NSInteger* output pointer for wordCount.
export const MACOS_SPELLING = String.raw`
function checkNativeWord(word) {
    const text = $(word);
    stage('spelling.check');
    const range = checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount(text, 0, $(), false, tag, Ref());
    const misspelled = Number(range.length) > 0;
    stage('spelling.suggest');
    const guesses = misspelled ? checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(range, text, $(), tag) : undefined;
    const suggestions = guesses ? ObjC.deepUnwrap(guesses) : [];
    return { misspelled: misspelled, suggestions: Array.isArray(suggestions) ? suggestions : [] };
}
`;

export const MACOS_HELPER = String.raw`
function stage(name) { console.log('AUTO_CORRECT_STAGE:' + name); }
stage('foundation.import');
ObjC.import('Foundation');
stage('appkit.import');
ObjC.import('AppKit');
stage('stdio.open');
const input = $.NSFileHandle.fileHandleWithStandardInput;
const output = $.NSFileHandle.fileHandleWithStandardOutput;
const newline = $('\n').dataUsingEncoding($.NSUTF8StringEncoding);
stage('spellchecker.create');
const checker = $.NSSpellChecker.sharedSpellChecker;
const tag = $.NSSpellChecker.uniqueSpellDocumentTag;
checker.automaticallyIdentifiesLanguages = true;
stage('spellchecker.ready');
function write(value) {
    output.writeData($(JSON.stringify(value) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function readLine() {
    const data = $.NSMutableData.data;
    while (true) {
        const byte = input.readDataOfLength(1);
        if (Number(byte.length) === 0) { stage('input.eof'); return null; }
        // Compare raw bytes: an individual UTF-8 byte may not be a valid NSString.
        if (byte.isEqualToData(newline)) {
            stage('input.decode');
            return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
        }
        data.appendData(byte);
    }
}
write({ready: true});
stage('ready.sent');
${MACOS_SPELLING}
while (true) {
    // Transport errors are fatal, not per-word errors: retrying a broken read
    // forever hides the original failure and prevents EOF/shutdown diagnostics.
    stage('input.wait');
    const line = readLine();
    if (line === null) break;
    let request;
    // JXA owns its bridged objects. Draining a manually created pool can
    // invalidate wrappers that JavaScriptCore still references on the next loop.
    try {
        stage('request.parse');
        request = JSON.parse(line);
        const result = checkNativeWord(request.word);
        stage('response.write');
        write({ id: request.id, misspelled: result.misspelled, suggestions: result.suggestions });
        stage('request.complete');
    } catch (error) {
        write({ id: request ? request.id : null, error: String(error) });
    }
}
stage('shutdown');
checker.closeSpellDocumentWithTag(tag);
stage('shutdown.complete');
`;
