// App.tsx
import 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';

import HomeScreen from './HomeScreen';

// Temporary workaround for RN/Navigation runtime type mismatch in some Expo/RN stacks.
enableScreens(false);

export type RootStackParamList = {
  Home: undefined;
  CollectCardData: undefined;
  CreateCard: undefined;
  TokenizeData: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

// Keep React Navigation on JS-based stack views to avoid native screen
// host prop type mismatches in Fabric for this demo app.
// TODO: Re-enable native screens after react-native-screens/Fabric prop
// mismatch issue is fixed in the demo stack setup.
enableScreens(false);

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          // Workaround for RN/Navigation host type mismatch in this example app.
          detachInactiveScreens={false}
          screenOptions={{
            gestureEnabled: true,
            headerShown: true,
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Home' }}
          />
          <Stack.Screen
            name="CollectCardData"
            getComponent={() => require('./use-cases/CollectCardData').default}
            options={{ title: 'Collect card data' }}
          />
          <Stack.Screen
            name="CreateCard"
            getComponent={() => require('./use-cases/CreateCard').default}
            options={{ title: 'Create Card' }}
          />
          <Stack.Screen
            name="TokenizeData"
            getComponent={() => require('./use-cases/TokenizeData').default}
            options={{ title: 'Tokenize Data' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
