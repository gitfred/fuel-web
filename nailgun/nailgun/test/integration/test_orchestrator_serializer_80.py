# -*- coding: utf-8 -*-

#    Copyright 2015 Mirantis, Inc.
#
#    Licensed under the Apache License, Version 2.0 (the "License"); you may
#    not use this file except in compliance with the License. You may obtain
#    a copy of the License at
#
#         http://www.apache.org/licenses/LICENSE-2.0
#
#    Unless required by applicable law or agreed to in writing, software
#    distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
#    WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
#    License for the specific language governing permissions and limitations
#    under the License.

from copy import deepcopy

from nailgun import consts
from nailgun.db.sqlalchemy import models
from nailgun import objects

from nailgun.orchestrator.deployment_graph import AstuteGraph
from nailgun.orchestrator.deployment_serializers import \
    get_serializer_for_cluster
from nailgun.orchestrator.neutron_serializers import \
    NeutronNetworkDeploymentSerializer80
from nailgun.orchestrator.neutron_serializers import \
    NeutronNetworkTemplateSerializer80
from nailgun.test.integration.test_orchestrator_serializer import \
    BaseDeploymentSerializer
from nailgun.test.integration.test_orchestrator_serializer import \
    TestSerializeInterfaceDriversData
from nailgun.test.integration.test_orchestrator_serializer_70 import \
    TestDeploymentHASerializer70


class TestSerializer80Mixin(object):
    env_version = "2015.1.0-8.0"

    def prepare_for_deployment(self, nodes, *_):
        objects.NodeCollection.prepare_for_deployment(nodes)

    def _check_baremetal_neutron_attrs(self, cluster):
        self.env._set_additional_component(cluster, 'ironic', True)
        self.env.create_node(cluster_id=cluster.id,
                             roles=['controller'])
        self.prepare_for_deployment(self.env.nodes)
        serialized_for_astute = self.serializer.serialize(
            cluster, cluster.nodes)
        for node in serialized_for_astute:
            expected_network = {
                "network_type": "flat",
                "segment_id": None,
                "router_ext": False,
                "physnet": "physnet-ironic"
            }
            self.assertEqual(expected_network, node['quantum_settings']
                             ['predefined_networks']['baremetal']['L2'])
            self.assertIn("physnet-ironic",
                          node['quantum_settings']['L2']['phys_nets'])
            self.assertEqual(consts.DEFAULT_BRIDGES_NAMES.br_ironic,
                             (node['quantum_settings']['L2']['phys_nets']
                              ["physnet-ironic"]["bridge"]))


class TestNetworkTemplateSerializer80(
    TestSerializer80Mixin,
    BaseDeploymentSerializer
):
    env_version = '2015.1.0-8.0'
    prepare_for_deployment = objects.NodeCollection.prepare_for_deployment

    def setUp(self, *args):
        super(TestNetworkTemplateSerializer80, self).setUp()
        cluster = self.env.create(
            release_kwargs={'version': self.env_version},
            cluster_kwargs={
                'mode': consts.CLUSTER_MODES.ha_compact,
                'net_provider': consts.CLUSTER_NET_PROVIDERS.neutron,
                'net_segment_type': consts.NEUTRON_SEGMENT_TYPES.vlan})
        self.net_template = self.env.read_fixtures(['network_template'])[0]
        self.cluster = self.db.query(models.Cluster).get(cluster['id'])

    def test_get_net_provider_serializer(self):
        serializer = get_serializer_for_cluster(self.cluster)
        self.cluster.network_config.configuration_template = None

        net_serializer = serializer.get_net_provider_serializer(self.cluster)
        self.assertIs(net_serializer, NeutronNetworkDeploymentSerializer80)

        self.cluster.network_config.configuration_template = \
            self.net_template
        net_serializer = serializer.get_net_provider_serializer(self.cluster)
        self.assertIs(net_serializer, NeutronNetworkTemplateSerializer80)

    def test_baremetal_neutron_attrs(self):
        brmtl_template = deepcopy(
            self.net_template['adv_net_template']['default'])
        brmtl_template['network_assignments']['baremetal'] = {
            'ep': 'br-baremetal'}
        brmtl_template['templates_for_node_role']['controller'].append(
            'baremetal')
        brmtl_template['nic_mapping']['default']['if8'] = 'eth7'
        brmtl_template['network_scheme']['baremetal'] = {
            'endpoints': ['br-baremetal'],
            'transformations': [],
            'roles': {'baremetal': 'br-baremetal'}}
        self.cluster.network_config.configuration_template = {
            'adv_net_template': {'default': brmtl_template}, 'pk': 1}
        serializer_type = get_serializer_for_cluster(self.cluster)
        self.serializer = serializer_type(AstuteGraph(self.cluster))
        self._check_baremetal_neutron_attrs(self.cluster)


class TestDeploymentAttributesSerialization80(
    TestSerializer80Mixin,
    BaseDeploymentSerializer
):
    env_version = '2015.1.0-8.0'

    def setUp(self):
        super(TestDeploymentAttributesSerialization80, self).setUp()
        self.cluster = self.env.create(
            release_kwargs={'version': self.env_version},
            cluster_kwargs={
                'mode': consts.CLUSTER_MODES.ha_compact,
                'net_provider': consts.CLUSTER_NET_PROVIDERS.neutron,
                'net_segment_type': consts.NEUTRON_SEGMENT_TYPES.vlan})
        self.cluster_db = self.db.query(models.Cluster).get(self.cluster['id'])
        serializer_type = get_serializer_for_cluster(self.cluster_db)
        self.serializer = serializer_type(AstuteGraph(self.cluster_db))

    def test_neutron_attrs(self):
        self.env.create_node(
            cluster_id=self.cluster_db.id,
            roles=['controller'], primary_roles=['controller']
        )
        self.prepare_for_deployment(self.env.nodes)
        serialized_for_astute = self.serializer.serialize(
            self.cluster_db, self.cluster_db.nodes)
        for node in serialized_for_astute:
            self.assertEqual(
                {
                    "bridge": consts.DEFAULT_BRIDGES_NAMES.br_floating,
                    "vlan_range": None
                },
                node['quantum_settings']['L2']['phys_nets']['physnet1']
            )
            l2 = (node["quantum_settings"]["predefined_networks"]
                  [self.cluster_db.network_config.floating_name]["L2"])

            self.assertEqual("physnet1", l2["physnet"])
            self.assertEqual("flat", l2["network_type"])

    def test_baremetal_transformations(self):
        self.env._set_additional_component(self.cluster_db, 'ironic', True)
        self.env.create_node(cluster_id=self.cluster_db.id,
                             roles=['primary-controller'])
        self.prepare_for_deployment(self.env.nodes)
        serialized_for_astute = self.serializer.serialize(
            self.cluster_db, self.cluster_db.nodes)
        for node in serialized_for_astute:
            transformations = node['network_scheme']['transformations']
            baremetal_brs = filter(lambda t: t.get('name') ==
                                   consts.DEFAULT_BRIDGES_NAMES.br_baremetal,
                                   transformations)
            baremetal_ports = filter(lambda t: t.get('name') == "eth0.104",
                                     transformations)
            expected_patch = {
                'action': 'add-patch',
                'bridges': [consts.DEFAULT_BRIDGES_NAMES.br_ironic,
                            consts.DEFAULT_BRIDGES_NAMES.br_baremetal],
                'provider': 'ovs'}
            self.assertEqual(len(baremetal_brs), 1)
            self.assertEqual(len(baremetal_ports), 1)
            self.assertEqual(baremetal_ports[0]['bridge'],
                             consts.DEFAULT_BRIDGES_NAMES.br_baremetal)
            self.assertIn(expected_patch, transformations)


class TestSerializeInterfaceDriversData80(
    TestSerializer80Mixin,
    TestSerializeInterfaceDriversData
):
    pass


class TestDeploymentHASerializer80(
    TestSerializer80Mixin,
    TestDeploymentHASerializer70
):
    pass
