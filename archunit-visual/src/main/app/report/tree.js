'use strict';

const predicates = require('./predicates');
const nodeTypes = require('./node-types.json');
const vectors = require('./vectors').vectors;
const ZeroCircle = require('./circles').ZeroCircle;
const NodeCircle = require('./circles').NodeCircle;

let layer = 0;

const init = (View, NodeText, visualizationFunctions, visualizationStyles) => {

  const packCirclesAndReturnEnclosingCircle = visualizationFunctions.packCirclesAndReturnEnclosingCircle;
  const calculateDefaultRadius = visualizationFunctions.calculateDefaultRadius;
  const calculateDefaultRadiusForNodeWithOneChild = visualizationFunctions.calculateDefaultRadiusForNodeWithOneChild;
  const createForceLinkSimulation = visualizationFunctions.createForceLinkSimulation;
  const createForceCollideSimulation = visualizationFunctions.createForceCollideSimulation;
  const runSimulations = visualizationFunctions.runSimulations;
  const arrayDifference = (arr1, arr2) => arr1.filter(x => arr2.indexOf(x) < 0);

  const NodeDescription = class {
    constructor(name, fullName, type) {
      this.name = name;
      this.fullName = fullName;
      this.type = type;
    }
  };

  const newFilters = (root) => ({
    typeFilter: null,
    nameFilter: null,

    apply: function () {
      root._resetFiltering();
      const applyFilter = (node, filter) => {
        node._setFilteredChildren(node._filteredChildren.filter(filter));
        node._filteredChildren.forEach(c => applyFilter(c, filter));
      };
      this.values().forEach(filter => applyFilter(root, filter));
    },

    values: function () {
      return [this.typeFilter, this.nameFilter].filter(f => !!f); // FIXME: We should not pass this object around to other modules (this is the reason for the name for now)
    }
  });

  const Node = class {
    constructor(jsonNode, svgContainer) {
      this.layer = layer++;
      this._description = new NodeDescription(jsonNode.name, jsonNode.fullName, jsonNode.type);
      this._text = new NodeText(this);
      this._folded = false;
      this._view = new View(svgContainer, this, () => this._changeFoldIfInnerNodeAndRelayout(), (dx, dy) => this._drag(dx, dy));
      this._filters = newFilters(this);
      this._listener = [];
    }

    addListener(listener) {
      this._listener.push(listener);
      this._originalChildren.forEach(child => child.addListener(listener));
    }

    _setFilteredChildren(filteredChildren) {
      this._filteredChildren = filteredChildren;
      this._updateViewOnCurrentChildrenChanged();
    }

    isPackage() {
      return this._description.type === nodeTypes.package;
    }

    isInterface() {
      return this._description.type === nodeTypes.interface;
    }

    getName() {
      return this._description.name;
    }

    getFullName() {
      return this._description.fullName;
    }

    getText() {
      return this._text;
    }

    getParent() {
      return this._parent;
    }

    getOriginalChildren() {
      return this._originalChildren;
    }

    getCurrentChildren() {
      return this._folded ? [] : this._filteredChildren;
    }

    _isLeaf() {
      return this._filteredChildren.length === 0;
    }

    isCurrentlyLeaf() {
      return this._isLeaf() || this._folded;
    }

    isPredecessorOf(nodeFullName) {
      const separator = /[\\.\\$]/;
      return (nodeFullName.startsWith(this.getFullName())
        && separator.test(nodeFullName.substring(this.getFullName().length, this.getFullName().length + 1)));
    }

    isPredecessorOfOrNodeItself(nodeFullName) {
      const separator = /[\\.\\$]/;
      const keyAfterFullName = nodeFullName.substring(this.getFullName().length, this.getFullName().length + 1);
      return (nodeFullName.startsWith(this.getFullName())
        && (keyAfterFullName.length === 0 || separator.test(keyAfterFullName)));
    }

    isFolded() {
      return this._folded;
    }

    _setFolded(getFolded, callback) {
      this._folded = getFolded();
      this._updateViewOnCurrentChildrenChanged();
      callback();
    }


    getFilters() {
      return this._filters;
    }

    getClass() {
      const foldableStyle = this._isLeaf() ? "not-foldable" : "foldable";
      return `node ${this._description.type} ${foldableStyle}`;
    }

    getSelfAndDescendants() {
      return [this, ...this._getDescendants()];
    }

    _getDescendantsExceptNodeAndItsDescendants(node) {
      const filteredChildren = this.getCurrentChildren().filter(child => child !== node);
      const result = filteredChildren.map(child => child._getDescendantsExceptNodeAndItsDescendants(node));
      return [].concat.apply([], [filteredChildren, ...result]);
    }

    _getDescendants() {
      const result = [];
      this.getCurrentChildren().forEach(child => child._callOnSelfThenEveryDescendant(node => result.push(node)));
      return result;
    }

    _callOnSelfThenEveryDescendant(fun) {
      fun(this);
      this.getCurrentChildren().forEach(c => c._callOnSelfThenEveryDescendant(fun));
    }

    callOnEveryDescendantThenSelf(fun) {
      this.getCurrentChildren().forEach(c => c.callOnEveryDescendantThenSelf(fun));
      fun(this);
    }

    /**
     * @param predicate A predicate (i.e. function Node -> boolean)
     * @return true, iff this Node or any child (after filtering) matches the predicate
     */
    _matchesOrHasChildThatMatches(predicate) {
      return predicate(this) || this._filteredChildren.some(node => node._matchesOrHasChildThatMatches(predicate));
    }

    getRadius() {
      return this.nodeCircle.getRadius();
    }

    _updateViewOnCurrentChildrenChanged() {
      this._view.updateNodeType(this.getClass());
      arrayDifference(this._originalChildren, this.getCurrentChildren()).forEach(child => child.hide());
      this.getCurrentChildren().forEach(child => child._isVisible = true);
    }

    hide() {
      this._isVisible = false;
      this._view.hide();
    }

    isVisible() {
      return this._isVisible;
    }

    /**
     * We go bottom to top through the tree, always creating a circle packing of the children and an enclosing
     * circle around those for the current node (but the circle packing is not applied to the nodes, it is only
     * for the radius-calculation)
     */
    _initialLayout() {
      const childrenPromises = this.getCurrentChildren().map(d => d._initialLayout());

      const promises = [];
      if (this.isCurrentlyLeaf()) {
        promises.push(this.nodeCircle.changeRadius(calculateDefaultRadius(this)));
      } else if (this.getCurrentChildren().length === 1) {
        const onlyChild = this.getCurrentChildren()[0];
        promises.push(onlyChild.nodeCircle.moveToPosition(0, 0));
        promises.push(this.nodeCircle.changeRadius(calculateDefaultRadiusForNodeWithOneChild(this,
          onlyChild.getRadius(), visualizationStyles.getNodeFontSize())));
      } else {
        const childCircles = this.getCurrentChildren().map(c => ({
          r: c.nodeCircle.getRadius()
        }));
        const circle = packCirclesAndReturnEnclosingCircle(childCircles, visualizationStyles.getCirclePadding());
        const r = Math.max(circle.r, calculateDefaultRadius(this));
        promises.push(this.nodeCircle.changeRadius(r));
      }
      return Promise.all([...childrenPromises, ...promises]);
    }

    /**
     * Shifts this node and its children.
     *
     * @param dx The delta in x-direction
     * @param dy The delta in y-direction
     */
    _drag(dx, dy) {
      this._root.doNextAndWaitFor(() => {
        this.nodeCircle.jumpToRelativeDisplacement(dx, dy);
        this._listener.forEach(listener => listener.onDrag(this));

        const nodesWithPotentialDependencies = this._root._getDescendants().filter(node => node._description.type !== nodeTypes.package || node.isFolded());
        this._listener.forEach(listener => listener.resetNodesOverlapping());
        nodesWithPotentialDependencies.reduce((acc, node) => node._checkOverlappingWithNodes(acc), nodesWithPotentialDependencies);
        this._listener.forEach(listener => listener.finishOnNodesOverlapping());
      });
    }

    _checkOverlappingWithNodes(nodes) {
      const nodesWithoutOwnDescendants = nodes.filter(node => !(node === this || this.isPredecessorOf(node.getFullName())));

      const isOverlappingWithAnyNode = nodesWithoutOwnDescendants.map(node => this._checkOverlappingWithSingleNode(node)).some(bol => bol);
      if (this._description.type !== nodeTypes.package || isOverlappingWithAnyNode) {
        return nodes.filter(node => node !== this);
      }
      else {
        return nodesWithoutOwnDescendants.filter(node => node !== this);
      }
    }

    _checkOverlappingWithSingleNode(node) {
      const middlePointDistance = vectors.distance(this.nodeCircle.absoluteCircle, node.nodeCircle.absoluteCircle);
      const areOverlapping = middlePointDistance <= this.getRadius() + node.getRadius();
      const sortedNodes = this.layer < node.layer ? {first: this, second: node} : {first: node, second: this};
      if (areOverlapping && sortedNodes.second._description.type !== nodeTypes.package) {
        this._listener.forEach(listener => listener.onNodesOverlapping(sortedNodes.first.getFullName(),
          sortedNodes.second.nodeCircle.absoluteCircle));
      }
      return areOverlapping;
    }

    _resetFiltering() {
      this.getOriginalChildren().forEach(node => node._resetFiltering());
      this._setFilteredChildren(this.getOriginalChildren());
    }

    /**
     * Hides all nodes that don't contain the supplied filterString.
     *
     * @param nodeNameSubstring The node's full name needs to contain this text, to pass the filter.
     * '*' matches any number of arbitrary characters. If nodeNamesSubstring ends with a space,
     * the node's full name has to end with nodeNamesSubstring to pass the filter.
     * @param exclude If true, the condition is inverted,
     * i.e. nodes with names not containing the string will pass the filter.
     */
    filterByName(nodeNameSubstring, exclude) {
      const stringContainsSubstring = predicates.stringContains(nodeNameSubstring);
      const stringPredicate = exclude ? predicates.not(stringContainsSubstring) : stringContainsSubstring;
      const nodeNameSatisfies = stringPredicate => node => stringPredicate(node.getFullName());

      this._filters.nameFilter = node => node._matchesOrHasChildThatMatches(nodeNameSatisfies(stringPredicate));
      this._root.doNextAndWaitFor(() => this._filters.apply());
    }

    filterByType(showInterfaces, showClasses) {
      let predicate = node => !node.isPackage();
      predicate = showInterfaces ? predicate : predicates.and(predicate, node => !node.isInterface());
      predicate = showClasses ? predicate : predicates.and(predicate, node => node.isInterface());

      this._filters.typeFilter = node => node._matchesOrHasChildThatMatches(predicate);
      this._root.doNextAndWaitFor(() => this._filters.apply());
    }
  };

  const Root = class extends Node {
    constructor(jsonNode, svgContainer, onRadiusChanged) {
      super(jsonNode, svgContainer);
      this._root = this;
      this._parent = this;
      this.nodeCircle = new NodeCircle(this,
        {
          onJumpedToPosition: () => this._view.jumpToPosition(this.nodeCircle.relativePosition),
          onRadiusChanged: () => Promise.all([this._view.changeRadius(this.nodeCircle.getRadius(), this._text.getY()), onRadiusChanged(this.getRadius())]),
          onMovedToPosition: () => this._view.moveToPosition(this.nodeCircle.relativePosition).then(() => this._view.showIfVisible(this)),
          onMovedToIntermediatePosition: () => this._view.startMoveToPosition(this.nodeCircle.relativePosition)
        },
        new ZeroCircle(this.getFullName()));

      this._originalChildren = Array.from(jsonNode.children || []).map(jsonChild => new InnerNode(jsonChild, this._view._svgElement, this, this));
      this._setFilteredChildren(this._originalChildren);

      this._updatePromise = Promise.resolve();
      const map = new Map();
      this._callOnSelfThenEveryDescendant(n => map.set(n.getFullName(), n));
      this.getByName = name => map.get(name);
      this.doNextAndWaitFor = fun => this._updatePromise = this._updatePromise.then(fun);
      let mustRelayout = false;
      this.relayoutCompletely = () => {
        mustRelayout = true;
        this.doNextAndWaitFor(() => {
          if (mustRelayout) {
            mustRelayout = false;
            return this._relayoutCompletely();
          }
          else {
            return Promise.resolve();
          }
        });
      }
    }

    foldAllNodes() {
      this.callOnEveryDescendantThenSelf(node => node._initialFold());
      this._listener.forEach(listener => listener.onAllNodesFoldedFinished());
      this.relayoutCompletely();
    }

    getSelfOrFirstPredecessorMatching(matchingFunction) {
      if (matchingFunction(this)) {
        return this;
      }
      return null;
    }

    isPredecessorOf() {
      return true;
    }

    getSelfAndPredecessorsUntilExclusively(predecessor) {
      if (predecessor === this) {
        return [];
      }
      return [this];
    }

    isRoot() {
      return true;
    }

    _initialFold() {
    }

    _changeFoldIfInnerNodeAndRelayout() {
    }

    getSelfAndPredecessors() {
      return [this];
    }

    _relayoutCompletely() {
      this._callOnSelfThenEveryDescendant(node => node.nodeCircle.absoluteCircle.unfix());
      const promiseInitialLayout = this._initialLayout();
      const promiseForceLayout = this._forceLayout();
      return Promise.all([promiseInitialLayout, promiseForceLayout]);
    }

    _initialLayout() {
      const layoutPromise = super._initialLayout();
      const promise = this.nodeCircle.moveToPosition(this.getRadius(), this.getRadius()); // Shift root to the middle
      return Promise.all([layoutPromise, promise]);
    }

    /**
     * We go top bottom through the tree, always applying a force-layout to all nodes so far (that means to all nodes
     * at the current level and all nodes above), while the nodes not on the current level are fixed (and so only
     * influence the other nodes)
     */
    _forceLayout() {
      const allLinks = this.getLinks();

      const allLayoutedNodesSoFar = new Map();
      let currentNodes = new Map();
      currentNodes.set(this.getFullName(), this);

      let promises = [];

      while (currentNodes.size > 0) {

        const newNodesArray = [].concat.apply([], Array.from(currentNodes.values()).map(node => node.getCurrentChildren()));
        const newNodes = new Map();
        newNodesArray.forEach(node => newNodes.set(node.getFullName(), node));
        if (newNodes.size === 0) {
          break;
        }

        newNodesArray.forEach(node => allLayoutedNodesSoFar.set(node.getFullName(), node));
        //take only links having at least one new end node and having both end nodes in allLayoutedNodesSoFar
        const currentLinks = allLinks.filter(link => (newNodes.has(link.source) || newNodes.has(link.target))
          && (allLayoutedNodesSoFar.has(link.source) && allLayoutedNodesSoFar.has(link.target)));

        const padding = visualizationStyles.getCirclePadding();
        const allLayoutedNodesSoFarAbsNodes = Array.from(allLayoutedNodesSoFar.values()).map(node => node.nodeCircle.absoluteCircle);
        const simulation = createForceLinkSimulation(padding, allLayoutedNodesSoFarAbsNodes, currentLinks);

        const currentInnerNodes = Array.from(currentNodes.values()).filter(node => !node.isCurrentlyLeaf());
        const allCollisionSimulations = currentInnerNodes.map(node =>
          createForceCollideSimulation(padding, node.getCurrentChildren().map(n => n.nodeCircle.absoluteCircle)));

        let timeOfLastUpdate = new Date().getTime();

        const onTick = () => {
          newNodesArray.forEach(node => node.nodeCircle.takeAbsolutePosition(visualizationStyles.getCirclePadding()));
          const updateInterval = 100;
          if ((new Date().getTime() - timeOfLastUpdate > updateInterval)) {
            promises = promises.concat(newNodesArray.map(node => node.nodeCircle.startMoveToIntermediatePosition()));
            timeOfLastUpdate = new Date().getTime();
          }
        };

        const k = runSimulations([simulation, ...allCollisionSimulations], simulation, 0, onTick);
        //run the remaining simulations of collision
        runSimulations(allCollisionSimulations, allCollisionSimulations[0], k, onTick);

        newNodesArray.forEach(node => node.nodeCircle.completeMoveToIntermediatePosition());
        currentNodes = newNodes;
      }

      this._listener.forEach(listener => promises.push(listener.onLayoutChanged()));
      return Promise.all(promises);
    }
  };

  const InnerNode = class extends Node {
    constructor(jsonNode, svgContainer, root, parent) {
      super(jsonNode, svgContainer);
      this._root = root;
      this._parent = parent;
      this.nodeCircle = new NodeCircle(this,
        {
          onJumpedToPosition: () => this._view.jumpToPosition(this.nodeCircle.relativePosition),
          onRadiusChanged: () => this._view.changeRadius(this.nodeCircle.getRadius(), this._text.getY()),
          onMovedToPosition: () => this._view.moveToPosition(this.nodeCircle.relativePosition).then(() => this._view.showIfVisible(this)),
          onMovedToIntermediatePosition: () => this._view.startMoveToPosition(this.nodeCircle.relativePosition)
        },
        this._parent.nodeCircle.absoluteCircle);

      this._originalChildren = Array.from(jsonNode.children || []).map(jsonChild => new InnerNode(jsonChild, this._view._svgElement, this._root, this));
      this._setFilteredChildren(this._originalChildren);
    }

    getSelfOrFirstPredecessorMatching(matchingFunction) {
      if (matchingFunction(this)) {
        return this;
      }
      return this._parent.getSelfOrFirstPredecessorMatching(matchingFunction);
    }

    getSelfAndPredecessorsUntilExclusively(predecessor) {
      if (predecessor === this) {
        return [];
      }
      const predecessors = this._parent.getSelfAndPredecessorsUntilExclusively(predecessor);
      return [...predecessors, this];
    }

    isRoot() {
      return false;
    }

    _initialFold() {
      if (!this._isLeaf()) {
        this._setFolded(() => true, () => this._listener.forEach(listener => listener.onInitialFold(this)));
      }
    }

    _changeFoldIfInnerNodeAndRelayout() {
      if (!this._isLeaf()) {
        this._setFolded(() => !this._folded, () => this._listener.forEach(listener => listener.onFold(this)));
        this._root.relayoutCompletely();
      }
    }

    getSelfAndPredecessors() {
      const predecessors = this._parent.getSelfAndPredecessors();
      return [this, ...predecessors];
    }
  };

  return Root;
};

module.exports.init = (View, NodeText, visualizationFunctions, visualizationStyles) => ({
  Root: init(View, NodeText, visualizationFunctions, visualizationStyles)
});