'use strict';

const init = (Root, Dependencies, View, visualizationStyles) => {

  const Graph = class {
    constructor(jsonRoot, svg) {
      this._view = new View(svg);
      this.root = new Root(jsonRoot, this._view.svgElementForNodes, rootRadius => this._view.renderWithTransition(rootRadius));
      this.dependencies = new Dependencies(jsonRoot, this.root, this._view.svgElementForDependencies);
      this.root.addListener(this.dependencies.createListener());
      this.root.getLinks = () => this.dependencies.getAllLinks();
      this.root.relayoutCompletely();
    }

    foldAllNodes() {
      this.root.callOnEveryDescendantThenSelf(node => node.foldIfInnerNode());
      this.root.relayoutCompletely();
    }

    filterNodesByNameContaining(filterString) {
      this.root.filterByName(filterString, false);
      this.dependencies.setNodeFilters(this.root.getFilters());
      this.root.relayoutCompletely();
    }

    filterNodesByNameNotContaining(filterString) {
      this.root.filterByName(filterString, true);
      this.dependencies.setNodeFilters(this.root.getFilters());
      this.root.relayoutCompletely();
    }

    filterNodesByType(filter) {
      this.root.filterByType(filter.showInterfaces, filter.showClasses);
      this.dependencies.setNodeFilters(this.root.getFilters());
      this.root.relayoutCompletely();
    }

    filterDependenciesByType(typeFilterConfig) {
      this.dependencies.filterByType(typeFilterConfig);
    }

    refresh() {
      this.root.relayoutCompletely();
    }

    attachToMenu(menu) {
      menu.initializeSettings(
        {
          initialCircleFontSize: visualizationStyles.getNodeFontSize(),
          initialCirclePadding: visualizationStyles.getCirclePadding()
        })
        .onSettingsChanged(
          (circleFontSize, circlePadding) => {
            visualizationStyles.setNodeFontSize(circleFontSize);
            visualizationStyles.setCirclePadding(circlePadding);
            this.refresh();
          })
        .onNodeTypeFilterChanged(
          filter => {
            this.filterNodesByType(filter);
          })
        .onDependencyFilterChanged(
          filter => {
            this.filterDependenciesByType(filter);
          })
        .onNodeNameFilterChanged((filterString, exclude) => {
          if (exclude) {
            this.filterNodesByNameNotContaining(filterString);
          } else {
            this.filterNodesByNameContaining(filterString);
          }
        })
        .initializeLegend([
          visualizationStyles.getLineStyle('constructorCall', 'constructor call'),
          visualizationStyles.getLineStyle('methodCall', 'method call'),
          visualizationStyles.getLineStyle('fieldAccess', 'field access'),
          visualizationStyles.getLineStyle('extends', 'extends'),
          visualizationStyles.getLineStyle('implements', 'implements'),
          visualizationStyles.getLineStyle('implementsAnonymous', 'implements anonymous'),
          visualizationStyles.getLineStyle('childrenAccess', 'innerclass access'),
          visualizationStyles.getLineStyle('several', 'grouped access')
        ]);
    }

    attachToViolationMenu(violationMenu) {
      violationMenu.initialize(
        violationsGroup => this.dependencies.showViolations(violationsGroup),
        violationsGroup => this.dependencies.hideViolations(violationsGroup),
        hide => this.dependencies.onHideAllOtherDependenciesWhenViolationExists(hide));
    }
  };

  return {
    Graph
  };
};

module.exports.init = init; // FIXME: Make create() the only public API

module.exports.create = () => {

  return new Promise((resolve, reject) => {
    const d3 = require('d3');
    const resources = require('./resources').resources;

    const appContext = require('./app-context').newInstance();
    const visualizationStyles = appContext.getVisualizationStyles();
    const Root = appContext.getRoot(); // FIXME: Correct dependency tree
    const Dependencies = appContext.getDependencies(); // FIXME: Correct dependency tree
    const graphView = appContext.getGraphView();

    const Graph = init(Root, Dependencies, graphView, visualizationStyles).Graph;
    resources.getClassesToVisualize().then(jsonRoot => {
      const graph = new Graph(jsonRoot, d3.select('#visualization').node());
      graph.foldAllNodes();
      resolve(graph);
    }, reject);
  });
};