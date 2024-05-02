"use client"

import Editor, { BeforeMount, OnMount } from "@monaco-editor/react"
import monaco from "monaco-editor"
import { use, useEffect, useRef, useState } from "react"
// import theme from "./theme.json"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  ChevronLeft,
  ChevronRight,
  FileJson,
  Plus,
  RotateCw,
  Shell,
  SquareTerminal,
  TerminalSquare,
} from "lucide-react"
import Tab from "../ui/tab"
import Sidebar from "./sidebar"
import { useClerk } from "@clerk/nextjs"
import { TFile, TFileData, TFolder, TTab } from "./sidebar/types"

import { io } from "socket.io-client"
import { processFileType, validateName } from "@/lib/utils"
import { toast } from "sonner"
import EditorTerminal from "./terminal"
import { Button } from "../ui/button"
import { User } from "@/lib/types"

export default function CodeEditor({
  userData,
  sandboxId,
}: {
  userData: User
  sandboxId: string
}) {
  const [files, setFiles] = useState<(TFolder | TFile)[]>([])
  const [editorLanguage, setEditorLanguage] = useState("plaintext")
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [tabs, setTabs] = useState<TTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cursorLine, setCursorLine] = useState(0)
  const [generate, setGenerate] = useState({ show: false, id: "" })
  const [decorations, setDecorations] = useState<{
    options: monaco.editor.IModelDeltaDecoration[]
    instance: monaco.editor.IEditorDecorationsCollection | undefined
  }>({ options: [], instance: undefined })
  const [terminals, setTerminals] = useState<string[]>([])

  const clerk = useClerk()

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const generateRef = useRef<HTMLDivElement>(null)

  const handleEditorWillMount: BeforeMount = (monaco) => {
    monaco.editor.addKeybindingRules([
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG,
        command: "null",
        // when: "textInputFocus",
      },
    ])
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    editor.onDidChangeCursorPosition((e) => {
      const { column, lineNumber } = e.position
      if (lineNumber === cursorLine) return
      setCursorLine(lineNumber)

      const model = editor.getModel()
      const endColumn = model?.getLineContent(lineNumber).length || 0

      setDecorations((prev) => {
        return {
          ...prev,
          options: [
            {
              range: new monaco.Range(
                lineNumber,
                column,
                lineNumber,
                endColumn
              ),
              options: {
                afterContentClassName: "inline-decoration",
              },
            },
          ],
        }
      })
    })

    editor.addAction({
      id: "generate",
      label: "Generate",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG],
      precondition:
        "editorTextFocus && !suggestWidgetVisible && !renameInputVisible && !inSnippetMode && !quickFixWidgetVisible",
      run: () => {
        setGenerate((prev) => {
          return { ...prev, show: !prev.show }
        })
      },
    })
  }

  useEffect(() => {
    if (generate.show) {
      editorRef.current?.changeViewZones(function (changeAccessor) {
        if (!generateRef.current) return
        const id = changeAccessor.addZone({
          afterLineNumber: cursorLine,
          heightInLines: 3,
          domNode: generateRef.current,
        })
        setGenerate((prev) => {
          return { ...prev, id }
        })
      })
    } else {
      editorRef.current?.changeViewZones(function (changeAccessor) {
        if (!generateRef.current) return
        changeAccessor.removeZone(generate.id)
        setGenerate((prev) => {
          return { ...prev, id: "" }
        })
      })
    }
  }, [generate.show])

  useEffect(() => {
    if (decorations.options.length === 0) return

    if (decorations.instance) {
      console.log("setting decorations")
      // decorations.instance.clear()
      decorations.instance.set(decorations.options)
    } else {
      console.log("creating decorations")
      const instance = editorRef.current?.createDecorationsCollection()
      instance?.set(decorations.options)

      setDecorations((prev) => {
        return {
          ...prev,
          instance,
        }
      })
    }
  }, [decorations.options])

  const socket = io(
    `http://localhost:4000?userId=${userData.id}&sandboxId=${sandboxId}`
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()

        const activeTab = tabs.find((t) => t.id === activeId)
        console.log("saving:", activeTab?.name, editorRef.current?.getValue())

        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeId ? { ...tab, saved: true } : tab
          )
        )

        socket.emit("saveFile", activeId, editorRef.current?.getValue())
      }
    }
    document.addEventListener("keydown", down)

    return () => {
      document.removeEventListener("keydown", down)
    }
  }, [tabs, activeId])

  // WS event handlers:

  // connection/disconnection effect
  useEffect(() => {
    socket.connect()

    return () => {
      socket.disconnect()
    }
  }, [])

  // event listener effect
  useEffect(() => {
    const onConnect = () => {}

    const onDisconnect = () => {}

    const onLoadedEvent = (files: (TFolder | TFile)[]) => {
      console.log("onLoadedEvent")
      setFiles(files)
    }

    socket.on("connect", onConnect)

    socket.on("disconnect", onDisconnect)
    socket.on("loaded", onLoadedEvent)

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("loaded", onLoadedEvent)
    }
  }, [])

  // Helper functions:

  const selectFile = (tab: TTab) => {
    setTabs((prev) => {
      const exists = prev.find((t) => t.id === tab.id)
      if (exists) {
        // console.log("exists")
        setActiveId(exists.id)
        return prev
      }
      return [...prev, tab]
    })
    socket.emit("getFile", tab.id, (response: string) => {
      setActiveFile(response)
    })
    setEditorLanguage(processFileType(tab.name))
    setActiveId(tab.id)
  }

  const closeTab = (tab: TFile) => {
    const numTabs = tabs.length
    const index = tabs.findIndex((t) => t.id === tab.id)

    if (index === -1) return

    const nextId =
      activeId === tab.id
        ? numTabs === 1
          ? null
          : index < numTabs - 1
          ? tabs[index + 1].id
          : tabs[index - 1].id
        : activeId
    const nextTab = tabs.find((t) => t.id === nextId)

    if (nextTab) selectFile(nextTab)
    else setActiveId(null)
    setTabs((prev) => prev.filter((t) => t.id !== tab.id))
  }

  const handleRename = (
    id: string,
    newName: string,
    oldName: string,
    type: "file" | "folder"
  ) => {
    if (!validateName(newName, oldName, type)) {
      toast.error("Invalid file name.")
      console.log("invalid name")
      return false
    }

    socket.emit("renameFile", id, newName)
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, name: newName } : tab))
    )

    return true
  }

  const handleDeleteFile = (file: TFile) => {
    socket.emit("deleteFile", file.id, (response: (TFolder | TFile)[]) => {
      setFiles(response)
    })
    closeTab(file)
  }

  const handleDeleteFolder = (folder: TFolder) => {
    // socket.emit("deleteFolder", folder.id, (response: (TFolder | TFile)[]) => {
    //   setFiles(response)
    // })
  }

  return (
    <>
      <div className="bg-blue-500" ref={generateRef}>
        {generate.show ? "HELLO" : null}
      </div>
      <Sidebar
        files={files}
        selectFile={selectFile}
        handleRename={handleRename}
        handleDeleteFile={handleDeleteFile}
        handleDeleteFolder={handleDeleteFolder}
        socket={socket}
        addNew={(name, type) => {
          if (type === "file") {
            console.log("adding file")
            setFiles((prev) => [
              ...prev,
              { id: `projects/${sandboxId}/${name}`, name, type: "file" },
            ])
          } else {
            console.log("adding folder")
            // setFiles(prev => [...prev, { id, name, type: "folder", children: [] }])
          }
        }}
      />
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          className="p-2 flex flex-col"
          maxSize={75}
          minSize={30}
          defaultSize={60}
        >
          <div className="h-10 w-full flex gap-2">
            {tabs.map((tab) => (
              <Tab
                key={tab.id}
                saved={tab.saved}
                selected={activeId === tab.id}
                onClick={() => {
                  selectFile(tab)
                }}
                onClose={() => closeTab(tab)}
              >
                {tab.name}
              </Tab>
            ))}
          </div>
          <div className="grow w-full overflow-hidden rounded-md">
            {activeId === null ? (
              <>
                <div className="w-full h-full flex items-center justify-center text-xl font-medium text-secondary select-none">
                  <FileJson className="w-6 h-6 mr-3" />
                  No file selected.
                </div>
              </>
            ) : clerk.loaded ? (
              <Editor
                height="100%"
                language={editorLanguage}
                beforeMount={handleEditorWillMount}
                onMount={handleEditorMount}
                onChange={(value) => {
                  setTabs((prev) =>
                    prev.map((tab) =>
                      tab.id === activeId ? { ...tab, saved: false } : tab
                    )
                  )
                }}
                options={{
                  minimap: {
                    enabled: false,
                  },
                  padding: {
                    bottom: 4,
                    top: 4,
                  },
                  scrollBeyondLastLine: false,
                  fixedOverflowWidgets: true,
                  fontFamily: "var(--font-geist-mono)",
                }}
                theme="vs-dark"
                value={activeFile ?? ""}
              />
            ) : null}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={40}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="p-2 flex flex-col"
            >
              <div className="h-10 select-none w-full flex gap-2">
                <div className="h-8 rounded-md px-3 text-xs bg-secondary flex items-center w-full justify-between">
                  Preview
                  <div className="flex space-x-1 translate-x-1">
                    <div className="p-0.5 h-5 w-5 ml-0.5 flex items-center justify-center transition-colors bg-transparent hover:bg-muted-foreground/25 cursor-pointer rounded-sm">
                      <TerminalSquare className="w-4 h-4" />
                    </div>
                    <div className="p-0.5 h-5 w-5 ml-0.5 flex items-center justify-center transition-colors bg-transparent hover:bg-muted-foreground/25 cursor-pointer rounded-sm">
                      <ChevronLeft className="w-4 h-4" />
                    </div>
                    <div className="p-0.5 h-5 w-5 ml-0.5 flex items-center justify-center transition-colors bg-transparent hover:bg-muted-foreground/25 cursor-pointer rounded-sm">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                    <div className="p-0.5 h-5 w-5 ml-0.5 flex items-center justify-center transition-colors bg-transparent hover:bg-muted-foreground/25 cursor-pointer rounded-sm">
                      <RotateCw className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="w-full grow rounded-md bg-foreground"></div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="p-2 flex flex-col"
            >
              <div className="h-10 w-full flex gap-2 shrink-0">
                <Tab selected>
                  <SquareTerminal className="w-4 h-4 mr-2" />
                  Shell
                </Tab>
                <Button
                  size="smIcon"
                  variant={"secondary"}
                  className={`font-normal select-none text-muted-foreground`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="w-full relative grow h-full overflow-hidden rounded-md bg-secondary">
                {socket ? <EditorTerminal socket={socket} /> : null}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
