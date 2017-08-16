class TaskDeps {
    constructor(name) {
        this.name = name;
        this.deps = [];
    }

    add(dep) {
        this.deps.push(dep);
    }
}

class DepNode {
    constructor(line, parent) {
        this.parent = parent;
        // line = line.replace(/[\+\-\\ ]\+/, '');
        var d = line.split(':');
        if (d.length == 2) {
            // project item
            this.group = 'project';
            this.artifact = d[1];
        } else if (d.length == 3) {
            this.group = d[0]
            this.artifact = d[1];
            this.version = d[2];
            var v = this.version.split(' -> ');
            if (v.length == 2) {
                this.originalVersion = v[0];
                this.actualVersion = v[1];
                this.versionReplaced = true;
            } else {
                this.originalVersion = this.version;
                this.actualVersion = this.version;
                this.versionReplaced = false;
            }
        }
    }

    add(node) {
        if (!this.children) {
            this.children = [];
        }
        this.children.push(node);
    }
}
var DEPTH_OFFSET = 5;

function isSameLevel(line, depth) {
    var headChar = line.charAt(depth);
    return headChar == '+' || headChar == '\\';
}

function parseDepNodeTree(parent, lines, depth, startIndex) {
    var lastNodeInCurrentLevel;
    var prefixLength = depth * DEPTH_OFFSET;
    for (var i = startIndex; i < lines.length;) {
        var line = lines[i];
        if (isSameLevel(line, prefixLength)) {
            if (lastNodeInCurrentLevel) {
                console.log("parsed", line);
            } else {
                console.info("startd", line);
            }
            lastNodeInCurrentLevel = new DepNode(line.substr(prefixLength + DEPTH_OFFSET));
            parent.add(lastNodeInCurrentLevel);
            
            i++;
        } else {
            if (isSameLevel(line, prefixLength + DEPTH_OFFSET)) {
                i = parseDepNodeTree(lastNodeInCurrentLevel, lines, depth + 1, i);
            } else {
                return i;
            }
            
        }
    }
}

function getDepHierachy(tasks) {
    var ths = [];
    tasks.forEach((t) => {
        var task = new TaskDeps(t.name);
        parseDepNodeTree(task, t.deps, 0, 0);
        ths.push(task);
    });
    return ths;
}


function getTaskDeps(depsContent) {
    var lines = depsContent.split('\n');
    var tasks = [];
    var hitTaskStartLine = false;
    var TASK_POSTFIX = ' - ## Internal use, do not manually configure ##';
    var t;
    lines.forEach((line) => {
        if (!hitTaskStartLine) {
            if (line.endsWith(TASK_POSTFIX)) {
                t = new TaskDeps(line.substr(0, line.length - TASK_POSTFIX.length));
                hitTaskStartLine = true;
                tasks.push(t);
            }
        } else if(line.length > 0) {
            if (line == 'No dependencies') {
                tasks.pop();
                hitTaskStartLine = false;
            } else {
                t.add(line);
            }
        } else {
            hitTaskStartLine = false;
        }
    });

    return getDepHierachy(tasks);
}


function handleFiles(files) {
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
                document.title = "Editing " + theFile.name;
                var tasks = getTaskDeps(e.target.result);
                console.log('valid tasks', JSON.stringify(tasks[2], 0, 2));
            }
        })(f);
        reader.readAsText(f);
        break;
    };
}

function handleSelectFile(event) {
    handleFiles(event.target.files);
}

function handleDragOver(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}

function handleDrop(event) {
    event.stopPropagation();
    event.preventDefault();
    var files = event.dataTransfer.files;
    handleFiles(files);
}

var select_file = document.getElementById('select-file');
select_file.addEventListener("change", handleSelectFile, false);
document.body.addEventListener("drop", handleDrop, false);
document.body.addEventListener("dragover", handleDragOver, false);


