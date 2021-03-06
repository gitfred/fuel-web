/*
 * Copyright 2015 Mirantis, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
**/
define(
[
    'underscore',
    'i18n',
    'utils',
    'react',
    'expression',
    'views/controls',
    'views/custom_controls'
],
function(_, i18n, utils, React, Expression, controls, customControls) {
    'use strict';

    var SettingSection = React.createClass({
        processRestrictions: function(sectionName, settingName) {
            var result = false,
                path = this.props.makePath(sectionName, settingName),
                messages = [];

            var restrictionsCheck = this.props.checkRestrictions('disable', path),
                messagesCheck = this.props.checkRestrictions('none', path);

            if (restrictionsCheck.message) messages.push(restrictionsCheck.message);
            if (messagesCheck.message) messages.push(messagesCheck.message);

            // FIXME: hack for #1442475 to lock images_ceph in env with controllers
            if (settingName == 'images_ceph') {
                if (_.contains(_.flatten(this.props.cluster.get('nodes').pluck('pending_roles')), 'controller')) {
                    result = true;
                    messages.push(i18n('cluster_page.settings_tab.images_ceph_warning'));
                }
            }

            return {
                result: result || restrictionsCheck.result,
                message: messages.join(' ')
            };
        },
        checkDependencies: function(sectionName, settingName) {
            var messages = [],
                dependentRoles = this.checkDependentRoles(sectionName, settingName),
                dependentSettings = this.checkDependentSettings(sectionName, settingName);

            if (dependentRoles.length) messages.push(i18n('cluster_page.settings_tab.dependent_role_warning', {roles: dependentRoles.join(', '), count: dependentRoles.length}));
            if (dependentSettings.length) messages.push(i18n('cluster_page.settings_tab.dependent_settings_warning', {settings: dependentSettings.join(', '), count: dependentSettings.length}));

            return {
                result: !!dependentRoles.length || !!dependentSettings.length,
                message: messages.join(' ')
            };
        },
        areCalculationsPossible: function(setting) {
            return setting.toggleable || _.contains(['checkbox', 'radio'], setting.type);
        },
        getValuesToCheck: function(setting, valueAttribute) {
            return setting.values ? _.without(_.pluck(setting.values, 'data'), setting[valueAttribute]) : [!setting[valueAttribute]];
        },
        checkValues: function(values, path, currentValue, restriction) {
            var extraModels = {settings: this.props.settingsForChecks};
            var result = _.all(values, function(value) {
                this.props.settingsForChecks.set(path, value);
                return new Expression(restriction.condition, this.props.configModels, restriction).evaluate(extraModels);
            }, this);
            this.props.settingsForChecks.set(path, currentValue);
            return result;
        },
        checkDependentRoles: function(sectionName, settingName) {
            if (!this.props.allocatedRoles.length) return [];
            var path = this.props.makePath(sectionName, settingName),
                setting = this.props.settings.get(path);
            if (!this.areCalculationsPossible(setting)) return [];
            var valueAttribute = this.props.getValueAttribute(settingName),
                valuesToCheck = this.getValuesToCheck(setting, valueAttribute),
                pathToCheck = this.props.makePath(path, valueAttribute),
                roles = this.props.cluster.get('roles');
            return _.compact(this.props.allocatedRoles.map(function(roleName) {
                var role = roles.findWhere({name: roleName});
                if (_.any(role.expandedRestrictions.restrictions, function(restriction) {
                    if (_.contains(restriction.condition, 'settings:' + path) && !(new Expression(restriction.condition, this.props.configModels, restriction).evaluate())) {
                        return this.checkValues(valuesToCheck, pathToCheck, setting[valueAttribute], restriction);
                    }
                    return false;
                }, this)) return role.get('label');
            }, this));
        },
        checkDependentSettings: function(sectionName, settingName) {
            var path = this.props.makePath(sectionName, settingName),
                currentSetting = this.props.settings.get(path);
            if (!this.areCalculationsPossible(currentSetting)) return [];
            var dependentRestrictions = {};
            var addDependentRestrictions = _.bind(function(pathToCheck, label) {
                var result = _.filter(this.props.settings.expandedRestrictions[pathToCheck], function(restriction) {
                    return restriction.action == 'disable' && _.contains(restriction.condition, 'settings:' + path);
                });
                if (result.length) {
                    dependentRestrictions[label] = result.concat(dependentRestrictions[label] || []);
                }
            }, this);
            // collect dependencies
            _.each(this.props.settings.attributes, function(group, sectionName) {
                // don't take into account hidden dependent settings
                if (this.props.checkRestrictions('hide', this.props.makePath(sectionName, 'metadata')).result) return;
                _.each(group, function(setting, settingName) {
                    // we support dependecies on checkboxes, toggleable setting groups, dropdowns and radio groups
                    var pathToCheck = this.props.makePath(sectionName, settingName);
                    if (!this.areCalculationsPossible(setting) || pathToCheck == path || this.props.checkRestrictions('hide', pathToCheck).result) return;
                    if (setting[this.props.getValueAttribute(settingName)] == true) {
                        addDependentRestrictions(pathToCheck, setting.label);
                    } else {
                        var activeOption = _.find(setting.values, {data: setting.value});
                        if (activeOption) addDependentRestrictions(this.props.makePath(pathToCheck, activeOption.data), setting.label);
                    }
                }, this);
            }, this);
            // evaluate dependencies
            if (!_.isEmpty(dependentRestrictions)) {
                var valueAttribute = this.props.getValueAttribute(settingName),
                    pathToCheck = this.props.makePath(path, valueAttribute),
                    valuesToCheck = this.getValuesToCheck(currentSetting, valueAttribute),
                    checkValues = _.partial(this.checkValues, valuesToCheck, pathToCheck, currentSetting[valueAttribute]);
                return _.compact(_.map(dependentRestrictions, function(restrictions, label) {
                    if (_.any(restrictions, checkValues)) return label;
                }));
            }
            return [];
        },
        composeOptions: function(values) {
            return _.map(values, function(value, index) {
                return (
                    <option key={index} value={value.data} disabled={value.disabled}>
                        {value.label}
                    </option>
                );
            });
        },
        render: function() {
            var group = this.props.settings.get(this.props.sectionName),
                metadata = group.metadata,
                sortedSettings = _.sortBy(this.props.settingsToDisplay, function(settingName) {return group[settingName].weight;}),
                processedGroupRestrictions = this.processRestrictions(this.props.sectionName, 'metadata'),
                processedGroupDependencies = this.checkDependencies(this.props.sectionName, 'metadata'),
                isGroupDisabled = this.props.locked || (this.props.lockedCluster && !metadata.always_editable) || processedGroupRestrictions.result,
                showSettingGroupWarning = !this.props.lockedCluster || metadata.always_editable,
                groupWarning = _.compact([processedGroupRestrictions.message, processedGroupDependencies.message]).join(' ');
            return (
                <div className='setting-section'>
                    {showSettingGroupWarning && processedGroupRestrictions.message &&
                        <div className='alert alert-warning'>{processedGroupRestrictions.message}</div>
                    }
                    <h3>
                        {metadata.toggleable ?
                            <controls.Input
                                type='checkbox'
                                name='metadata'
                                label={metadata.label || this.props.sectionName}
                                defaultChecked={metadata.enabled}
                                disabled={isGroupDisabled || processedGroupDependencies.result}
                                tooltipText={showSettingGroupWarning && groupWarning}
                                onChange={this.props.onChange}
                            />
                        :
                            <span className={'subtab-group-' + this.props.sectionName}>{this.props.sectionName == 'common' ? i18n('cluster_page.settings_tab.groups.common') : metadata.label || this.props.sectionName}</span>
                        }
                    </h3>
                    <div>
                        {_.map(sortedSettings, function(settingName) {
                            var setting = group[settingName],
                                path = this.props.makePath(this.props.sectionName, settingName),
                                error = (this.props.settings.validationError || {})[path],
                                processedSettingRestrictions = this.processRestrictions(this.props.sectionName, settingName),
                                processedSettingDependencies = this.checkDependencies(this.props.sectionName, settingName),
                                isSettingDisabled = isGroupDisabled || (metadata.toggleable && !metadata.enabled) || processedSettingRestrictions.result || processedSettingDependencies.result,
                                showSettingWarning = showSettingGroupWarning && !isGroupDisabled && (!metadata.toggleable || metadata.enabled),
                                settingWarning = _.compact([processedSettingRestrictions.message, processedSettingDependencies.message]).join(' ');

                            // support of custom controls
                            var CustomControl = customControls[setting.type];
                            if (CustomControl) {
                                return <CustomControl
                                    {...setting}
                                    {... _.pick(this.props, 'cluster', 'settings', 'configModels')}
                                    key={settingName}
                                    path={path}
                                    error={error}
                                    disabled={isSettingDisabled}
                                    tooltipText={showSettingWarning && settingWarning}
                                />;
                            }

                            if (setting.values) {
                                var values = _.chain(_.cloneDeep(setting.values))
                                    .map(function(value) {
                                        var valuePath = this.props.makePath(path, value.data),
                                            processedValueRestrictions = this.props.checkRestrictions('disable', valuePath);
                                        if (!this.props.checkRestrictions('hide', valuePath).result) {
                                            value.disabled = isSettingDisabled || processedValueRestrictions.result;
                                            value.defaultChecked = value.data == setting.value;
                                            value.tooltipText = showSettingWarning && processedValueRestrictions.message;
                                            return value;
                                        }
                                    }, this)
                                    .compact()
                                    .value();
                                if (setting.type == 'radio') return <controls.RadioGroup {...this.props}
                                    key={settingName}
                                    name={settingName}
                                    label={setting.label}
                                    values={values}
                                    error={error}
                                    tooltipText={showSettingWarning && settingWarning}
                                />;
                            }

                            var settingDescription = setting.description &&
                                    <span dangerouslySetInnerHTML={{__html: utils.urlify(_.escape(setting.description))}} />;
                            return <controls.Input
                                {... _.pick(setting, 'type', 'label')}
                                key={settingName}
                                name={settingName}
                                description={settingDescription}
                                children={setting.type == 'select' ? this.composeOptions(setting.values) : null}
                                debounce={setting.type == 'text' || setting.type == 'password' || setting.type == 'textarea'}
                                defaultValue={setting.value}
                                defaultChecked={_.isBoolean(setting.value) ? setting.value : false}
                                toggleable={setting.type == 'password'}
                                error={error}
                                disabled={isSettingDisabled}
                                tooltipText={showSettingWarning && settingWarning}
                                onChange={this.props.onChange}
                            />;
                        }, this)}
                    </div>
                </div>
            );
        }
    });

    return SettingSection;
});
