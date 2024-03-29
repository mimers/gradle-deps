var OMMITTED_POSTFIX = ' (*)';


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
        this.explicity = (this.parent == null || this.parent instanceof TaskDeps || this.parent.isLibraryModule);
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
    var rst = 0;
    if (a.explicity) {
        rst -= 1000;
    }
    if (b.explicity) {
        rst += 1000;
    }
    if (a.group > b.group) {
        rst += 100;
    } else if (a.group < b.group) {
        rst -= 100;
    }
    if (a.artifact > b.artifact) {
        rst += 10;
    } else if (a.artifact < b.artifact) {
        rst -= 10;
    }
    return rst;

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
            lastNodeInCurrentLevel = new DepNode(line.substr(prefixLength + DEPTH_OFFSET), parent);
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
        line = line.replace('\r', '');
        if (!hitTaskStartLine) {
            var regMatch = line.match(/(\w+) - .+$/);
            if (regMatch) {
                t = new TaskDeps(regMatch[1]);
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

function getFlattenedDeps(nodes, deps) {
    nodes
        // .filter((node) => !node.ommitted)
        .forEach((node) => {
            var sameDepNode = deps.find((d) => node.equals(d));
            if (!sameDepNode) {
                deps.push(node);
            } else if (node.explicity) {
                deps[deps.indexOf(sameDepNode)] = node;
            }
            if (node.children) {
                getFlattenedDeps(node.children, deps);
            }
        });
}

function findSameNodes(node, deps) {
    var sameDeps = [];
    deps.forEach((dep) => {
        if (dep != node && dep.equalsIgnoreVersion(node)) {
            sameDeps.push(dep);
        }
        if (dep.children) {
            sameDeps = sameDeps.concat(findSameNodes(node, dep.children));
        }
    });
    return sameDeps;
}

function formatDeps(deps, task) {
    return deps
        .filter((dep) => !dep.isLibraryModule)
        .sort(DepNodeCompartor).map((dep) => {
        var imp = !dep.explicity;
        if (dep.versionReplaced || imp) {
            var sameNodes = findSameNodes(dep, task.deps);
            sameNodes.push(dep);
            dep.sameDepChains = sameNodes.map((node) => {
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
            }).sort((chainb, chaina) => {
                var actualReplaceA = chaina[0].originalVersion == dep.actualVersion;
                var autoUpgradeA = chaina[0].originalVersion != dep.originalVersion;

                var actualReplaceB = chainb[0].originalVersion == dep.actualVersion;
                var autoUpgradeB = chainb[0].originalVersion != dep.originalVersion;

                var valueA = (actualReplaceA ? 10000 : 0) + (autoUpgradeA ? 1000 : 0) + chaina.length;
                var valueB = (actualReplaceB ? 10000 : 0) + (autoUpgradeB ? 1000 : 0) + chainb.length;
                return valueA - valueB;
            });
            if (dep.sameDepChains.length == 0) {
                dep.sameDepChains = false;
            }
        } else {
            dep.sameDepChains = undefined;
        }
        dep.showSameChains = false;
        return dep;
    });
}

function resovleDeps(task) {
    if (!task.resovled) {
        var flattenedDeps = [];
        getFlattenedDeps(task.deps, flattenedDeps);
        task.resovled = formatDeps(flattenedDeps, task);
    }
    return task.resovled.filter(d => d.artifact);
}

function renderDepList(task) {
    var flattenedDeps = resovleDeps(task);
    vue.warn = flattenedDeps.filter((n) => n.versionReplaced);
    vue.deps = flattenedDeps;
    vue.renderedTask = task;
}

function semverComparator(a, b) {
    var versionASegs = a.split(".").map(n => Number.parseInt(n));
    var versionBSegs = b.split(".").map(n => Number.parseInt(n));
    while (versionASegs.length && versionBSegs.length) {
        var va = versionASegs.shift();
        var vb = versionBSegs.shift();
        if (va != vb) {
            return va > vb ? 1 : -1;
        }
    }
    return va.length > 0 ? 1 : (vb.length > 0 ? -1 : 0);
}

function renderDiff(aTask, bTask) {
    if (!aTask || !bTask) {
        alert('空task');
        return;
    }
    var sameTaskName = aTask.name == bTask.name;
    var aDeps = resovleDeps(aTask);
    var bDeps = resovleDeps(bTask);
    var unionDeps = [];
    var addedDeps = bDeps.filter((dep) => {
        return !aDeps.find(ait => {
            var sameDep = dep.equalsIgnoreVersion(ait);
            if (sameDep) {
                unionDeps.push({
                    a: ait,
                    b: dep
                });
            }
            return sameDep;
        });
    });
    var removedDeps = aDeps.filter(dep => {
        return !bDeps.find(bit => {
            return dep.equalsIgnoreVersion(bit);
        });
    });
    unionDeps = unionDeps.map(pair => {
        var versionA = pair.a.actualVersion;
        var versionB = pair.b.actualVersion;
        var cmp = semverComparator(versionA, versionB);
        if (cmp > 0) {
            pair.downgradedVeresion = true;
        } else if (cmp < 0) {
            pair.upgradedVersion = true;
        } else {
            pair.sameVersion = true;
        }
        return pair;
    });
    vue.addedDeps = addedDeps;
    vue.removedDeps = removedDeps;
    vue.upgradedDeps = unionDeps.filter(d => d.upgradedVersion);
    vue.downgradedDeps = unionDeps.filter(d => d.downgradedVeresion);
    vue.showDepDiff = true;
    vue.renderedDiffTaskName = aTask.name;
}

var firstRenderTasks = {},
    secondDiffTasks = {};

function handleFileContent(name, content, secondFile) {
    var tasks = getTaskDeps(content);
    if (!secondFile) {
        vue.firstFileName = name;
        vue.taskNameList = tasks.map(function(t) {
            return {
                name: t.name
            };
        });
        firstRenderTasks = {};
        tasks.forEach(function(t) {
            firstRenderTasks[t.name] = t;
        });
        var compileTask = tasks.find(t => t.deps.length) || tasks[0];
        vue.renderedTaskName = compileTask.name;
        renderDepList(compileTask);
        vue.firstFileDone = true;
        document.title = name + " | Fancy Gradle Deps"
    } else {
        vue.secondFileName = name;
        var currentTask = vue.renderedTask;
        tasks.forEach((t) => {
            secondDiffTasks[t.name] = t;
        });
        vue.diffTaskNameList = vue.taskNameList.filter(tn => {
            return tasks.find((t) => t.name == tn.name);
        });
        renderDiff(currentTask, secondDiffTasks[currentTask.name]);
    }
}


function handleFiles(files, secondFile) {
    var f = files[0];
    var reader = new FileReader();
    reader.onload = (function(theFile, secondFile) {
        return function(e) {
            handleFileContent(theFile.name, e.target.result, secondFile);
        }
    })(f, secondFile);
    reader.readAsText(f);
}

(function init() {
    vue = new Vue({
        el: '#container',
        data: {
            deps: [],
            taskNameList: [],
            showImp: true,
            dialogDep: false,
            firstFileDone: false,
            renderedTask: null,
            addedDeps: [],
            removedDeps: [],
            unionDeps: [],
            showDepDiff: false,
            firstFileName: '',
            secondFileName: '',
            renderedTaskName: '',
            renderedDiffTaskName: ''
        },
        methods: {
            handleSelectFile: function(e) {
                handleFiles(e.target.files);
                e.target.value = '';
            },
            handleSelectFile2: function(e) {
                handleFiles(e.target.files, true);
                e.target.value = '';
            },
            expandDep: function(index) {
                var curDep = this.deps[index];
                if (!curDep.explicity || (curDep.sameDepChains && curDep.versionReplaced)) {
                    this.dialogDep = curDep;
                }
            },
            selectDiffTask: function (e) {
                var task = e.currentTarget.value;
                renderDiff(firstRenderTasks[task], secondDiffTasks[task]);
            },
            selectTask: function(e) {
                var task = e.currentTarget.value;
                renderDepList(firstRenderTasks[task]);
            },
            closeDiffDialog: function(e) {
                if (!e.target.className.includes("fullscreen-modal-dialog")) {
                    return;
                }
                this.showDepDiff = false;
            },
            closeDialog: function(e) {
                if (!e.target.className.includes("fullscreen-modal-dialog")) {
                    return;
                }
                this.dialogDep = false;
            }
        }
    });
})();