var OMMITTED_POSTFIX = ' (*)';
var TASK_POSTFIX = ' - ## Internal use, do not manually configure ##';


class TaskDeps {
    constructor(name, projectName) {
        this.name = name;
        this.deps = [];
        if (projectName) {
            this.artifact = projectName;
        }
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
        if (line.startsWith('project :')) {
            // project item
            this.group = 'project';
            this.artifact = d[1];
            this.isLibraryModule = true;
        } else if (d.length == 3) {
            this.group = d[0]
            this.artifact = d[1];
            var version = d[2];
            if (version.endsWith(OMMITTED_POSTFIX)) {
                this.ommitted = true;
                version = version.substr(0, version.length - OMMITTED_POSTFIX.length);
            }
            var v = version.split(' -> ');
            if (v.length == 2) {
                this.originalVersion = v[0];
                this.actualVersion = v[1];
                this.versionReplaced = true;
            } else {
                this.originalVersion = version;
                this.actualVersion = version;
            }
        }
    }

    equals(o) {
        return this.group == o.group && this.artifact == o.artifact && this.actualVersion == o.actualVersion;
    }

    equalsIgnoreVersion(o) {
        return this.group == o.group && this.artifact == o.artifact;
    }

    add(node) {
        if (!this.children) {
            this.children = [];
        }
        this.children.push(node);
    }
}

function DepNodeCompartor(a, b) {
    if (a.group == b.group) {
        if (a.artifact == b.artifact) {
            return 0;
        } else {
            return a.artifact > b.artifact ? 1 : -1;
        }
    } else {
        return a.group > b.group ? 1 : -1;
    }
}

function uniqFilter(value, index, self) {
    return self.indexOf(value) === index;
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
            lastNodeInCurrentLevel = new DepNode(line.substr(prefixLength + DEPTH_OFFSET));
            parent.add(lastNodeInCurrentLevel);
            lastNodeInCurrentLevel.parent = parent;
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

function getDepHierachy(tasks, projectName) {
    var ths = [];
    tasks.forEach((t) => {
        var task = new TaskDeps(t.name, projectName);
        parseDepNodeTree(task, t.deps, 0, 0);
        ths.push(task);
    });
    return ths;
}


function getTaskDeps(depsContent) {
    var lines = depsContent.split('\n');
    var tasks = [];
    var hitTaskStartLine = false;
    var t;
    var projectName;
    var projectLine = lines.find((line, index) => {
        if (line.startsWith('Project :') &&
            index > 0 && lines[index - 1].startsWith('-------') &&
            index < lines.length - 1 && lines[index + 1].startsWith('-------')) {
            return true;
        }
    });
    if (projectLine) {
        projectName = projectLine.substr('Project :'.length);
    }
    lines.forEach((line) => {
        line = line.trim();
        if (!hitTaskStartLine) {
            if (line.endsWith(TASK_POSTFIX)) {
                t = new TaskDeps(line.substr(0, line.length - TASK_POSTFIX.length));
                hitTaskStartLine = true;
                tasks.push(t);
            }
        } else if (line.length > 0) {
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

    return getDepHierachy(tasks, projectName);
}


function getFirstReleaseApkTaskDeps(tasks) {
    return tasks.find((t) => t.name.endsWith('eleaseApk'));
}

function getFlattenedDeps(nodes, exp, imp) {
    nodes.filter((node) => !node.ommitted).forEach((node) => {
        if (node.parent instanceof DepNode && !node.parent.isLibraryModule) {
            if (!imp.find((d) => node.equals(d))) {
                imp.push(node);
            }
        } else {
            if (!exp.find((d) => node.equals(d))) {
                exp.push(node);
            }
        }
        if (node.children) {
            getFlattenedDeps(node.children, exp, imp);
        }
    });
}

function findSameNodes(node, deps) {
    var sameDeps = [];
    deps.forEach((dep) => {
        if (dep != node && dep.equalsIgnoreVersion(node)) {
            sameDeps.push(dep);
        } else if (dep.children) {
            sameDeps = sameDeps.concat(findSameNodes(node, dep.children));
        }
    });
    return sameDeps;
}

function getDepsList(task) {
    var explicitly = [];
    var implicitly = [];
    console.log('processing task', task.name);
    getFlattenedDeps(task.deps, explicitly, implicitly);
    explicitly = explicitly.filter((dep) => !dep.isLibraryModule).sort(DepNodeCompartor);
    implicitly = implicitly.filter((dep) => !dep.isLibraryModule).sort(DepNodeCompartor);
    console.log(explicitly, implicitly);
    var expWarning = explicitly.filter((n) => n.versionReplaced);
    vue.warn = expWarning.map((node) => {
        return {
            node: node,
            sameDepChains: findSameNodes(node, task.deps).map((node) => {
                var chain = [node];
                while (node.parent) {
                    if (node.isLibraryModule) {
                        break;
                    } else {
                        chain.push(node.parent);
                        node = node.parent;
                    }

                }
                return chain;
            })
        };
    });
    vue.exp = explicitly;
    vue.imp = implicitly;
}

function handleFiles(files) {
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
                document.title = "Editing " + theFile.name;
                var tasks = getTaskDeps(e.target.result);
                var release = getFirstReleaseApkTaskDeps(tasks);
                var result = getDepsList(release);
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
document.addEventListener('DOMContentLoaded', () => {
    var select_file = document.getElementById('select-file');
    select_file.addEventListener("change", handleSelectFile, false);
    document.body.addEventListener("drop", handleDrop, false);
    document.body.addEventListener("dragover", handleDragOver, false);
    vue = new Vue({
        el: '#container',
        data: {
            exp: [],
            imp: [],
            showImp: false
        }
    });
})